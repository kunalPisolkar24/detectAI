package services

import (
	"context"
	"errors"
	"time"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/cache/coalescer"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/cache/keys"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/cache/lock"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/models"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/observability"
)

// cachedChat returns the chat meta, cache first. Same-process duplicates are
// coalesced, then a distributed lock serializes cold fills across replicas;
// the locked closure re-reads the cache before touching Mongo. A cached chat
// carries its owner, so the ownership rule holds on a hit as well as on a miss.
func (s *ChatService) cachedChat(ctx context.Context, ownerID, chatID string) (models.Chat, error) {
	resource := keys.ChatResource(chatID)
	return coalescer.Coalesce(s.flights, ctx, keys.FlightKey("chat", resource), func(ctx context.Context) (models.Chat, error) {
		if cached, found, err := s.readChatCache(ctx, ownerID, chatID); found || err != nil {
			return cached, err
		}
		return lock.Execute(ctx, s.locker, keys.LockKey(resource), s.policy, func(ctx context.Context) (models.Chat, error) {
			if cached, found, err := s.readChatCache(ctx, ownerID, chatID); found || err != nil {
				return cached, err
			}
			chat, err := s.repo.Chat(ctx, ownerID, chatID)
			if err != nil {
				if errors.Is(err, models.ErrNotFound) {
					s.markMissing(ctx, ownerID, chatID)
				}
				return models.Chat{}, err
			}
			s.putChat(ctx, chat)
			return chat, nil
		})
	})
}

func (s *ChatService) cachedList(ctx context.Context, ownerID string, limit int) ([]models.ChatSummary, error) {
	resource := keys.OwnerChatsResource(ownerID)
	return coalescer.Coalesce(s.flights, ctx, keys.FlightKey("chats", resource), func(ctx context.Context) ([]models.ChatSummary, error) {
		if cached, found := s.readListCache(ctx, ownerID, limit); found {
			return cached, nil
		}
		return lock.Execute(ctx, s.locker, keys.LockKey(resource), s.policy, func(ctx context.Context) ([]models.ChatSummary, error) {
			if cached, found := s.readListCache(ctx, ownerID, limit); found {
				return cached, nil
			}
			chats, err := s.repo.Chats(ctx, ownerID, models.DefaultChatsLimit)
			if err != nil {
				return nil, err
			}
			s.putChatList(ctx, ownerID, chats)
			return trimSummaries(chats, limit), nil
		})
	})
}

// headPage returns a chat's head page, cache first, trimmed to the requested
// limit. The cache always holds a full page, so a smaller request trims it
// and the larger one reads the source.
func (s *ChatService) headPage(ctx context.Context, ownerID, chatID string, limit int) (models.Page, error) {
	resource := keys.ChatHeadResource(chatID)
	return coalescer.Coalesce(s.flights, ctx, keys.FlightKey("head", resource), func(ctx context.Context) (models.Page, error) {
		if page, found, err := s.readHeadCache(ctx, chatID, limit); found || err != nil {
			return page, err
		}
		return lock.Execute(ctx, s.locker, keys.LockKey(resource), s.policy, func(ctx context.Context) (models.Page, error) {
			if page, found, err := s.readHeadCache(ctx, chatID, limit); found || err != nil {
				return page, err
			}
			messages, next, err := s.repo.ChatHistory(ctx, ownerID, chatID, "", models.DefaultHistoryLimit)
			if err != nil {
				return models.Page{}, err
			}
			page := models.Page{Messages: messages, NextCursor: next}
			s.putHead(ctx, chatID, page)
			return trimPage(chatID, page, limit)
		})
	})
}

func (s *ChatService) readChatCache(ctx context.Context, ownerID, chatID string) (models.Chat, bool, error) {
	start := time.Now()
	cached, found, err := s.cache.Chat(ctx, chatID)
	s.recordCacheRead(observability.CacheOperationChat, found, err, start)
	if err != nil {
		s.absorb(ctx, "chat read", err)
		return models.Chat{}, false, nil
	}
	if found {
		if cached.UserID != ownerID {
			return models.Chat{}, false, models.ErrNotFound
		}
		return cached, true, nil
	}

	start = time.Now()
	missing, err := s.cache.Missing(ctx, ownerID, chatID)
	s.recordCacheRead(observability.CacheOperationNegative, missing, err, start)
	if err != nil {
		s.absorb(ctx, "negative read", err)
		return models.Chat{}, false, nil
	}
	if missing {
		return models.Chat{}, false, models.ErrNotFound
	}
	return models.Chat{}, false, nil
}

func (s *ChatService) markMissing(ctx context.Context, ownerID, chatID string) {
	start := time.Now()
	err := s.cache.MarkMissing(ctx, ownerID, chatID)
	s.recordCacheWrite(observability.CacheOperationPutNegative, err, start)
	if err != nil {
		s.absorb(ctx, "negative write", err)
	}
}

func (s *ChatService) clearMissing(ctx context.Context, ownerID, chatID string) {
	start := time.Now()
	err := s.cache.ClearMissing(ctx, ownerID, chatID)
	s.recordCacheWrite(observability.CacheOperationClearNegative, err, start)
	if err != nil {
		s.absorb(ctx, "negative invalidation", err)
	}
}

func (s *ChatService) readListCache(ctx context.Context, ownerID string, limit int) ([]models.ChatSummary, bool) {
	start := time.Now()
	cached, found, err := s.cache.ChatList(ctx, ownerID)
	s.recordCacheRead(observability.CacheOperationChatList, found, err, start)
	if err != nil {
		s.absorb(ctx, "chat list read", err)
		return nil, false
	}
	if !found {
		return nil, false
	}
	return trimSummaries(cached, limit), true
}

func (s *ChatService) readHeadCache(ctx context.Context, chatID string, limit int) (models.Page, bool, error) {
	start := time.Now()
	cached, found, err := s.cache.Head(ctx, chatID)
	s.recordCacheRead(observability.CacheOperationHead, found, err, start)
	if err != nil {
		s.absorb(ctx, "head read", err)
		return models.Page{}, false, nil
	}
	if !found {
		return models.Page{}, false, nil
	}
	page, err := trimPage(chatID, cached, limit)
	return page, true, err
}

func (s *ChatService) invalidateChat(ctx context.Context, chatID, ownerID string) {
	start := time.Now()
	err := s.cache.InvalidateChat(ctx, chatID)
	s.recordCacheWrite(observability.CacheOperationInvalidateChat, err, start)
	if err != nil {
		s.absorb(ctx, "chat invalidation", err)
	}
	s.clearMissing(ctx, ownerID, chatID)
	s.invalidateOwner(ctx, ownerID)
}

func (s *ChatService) invalidateMeta(ctx context.Context, chatID, ownerID string) {
	start := time.Now()
	err := s.cache.InvalidateMeta(ctx, chatID)
	s.recordCacheWrite(observability.CacheOperationInvalidateMeta, err, start)
	if err != nil {
		s.absorb(ctx, "chat meta invalidation", err)
	}
	s.clearMissing(ctx, ownerID, chatID)
	s.invalidateOwner(ctx, ownerID)
}

func (s *ChatService) invalidateOwner(ctx context.Context, ownerID string) {
	start := time.Now()
	err := s.cache.InvalidateOwner(ctx, ownerID)
	s.recordCacheWrite(observability.CacheOperationInvalidateOwner, err, start)
	if err != nil {
		s.absorb(ctx, "owner invalidation", err)
	}
}

func (s *ChatService) putChat(ctx context.Context, chat models.Chat) {
	start := time.Now()
	err := s.cache.PutChat(ctx, chat)
	s.recordCacheWrite(observability.CacheOperationPutChat, err, start)
	if err != nil {
		s.absorb(ctx, "chat write", err)
	}
}

func (s *ChatService) putChatList(ctx context.Context, ownerID string, chats []models.ChatSummary) {
	start := time.Now()
	err := s.cache.PutChatList(ctx, ownerID, chats)
	s.recordCacheWrite(observability.CacheOperationPutChatList, err, start)
	if err != nil {
		s.absorb(ctx, "chat list write", err)
	}
}

func (s *ChatService) putHead(ctx context.Context, chatID string, page models.Page) {
	start := time.Now()
	err := s.cache.PutHead(ctx, chatID, page)
	s.recordCacheWrite(observability.CacheOperationPutHead, err, start)
	if err != nil {
		s.absorb(ctx, "head write", err)
	}
}

func (s *ChatService) recordCacheRead(operation string, found bool, err error, start time.Time) {
	result := observability.CacheMiss
	switch {
	case err != nil:
		result = observability.CacheError
	case found:
		result = observability.CacheHit
	}
	s.telemetry.RecordCacheOp(operation, result, time.Since(start))
}

func (s *ChatService) recordCacheWrite(operation string, err error, start time.Time) {
	result := observability.CacheOK
	if err != nil {
		result = observability.CacheError
	}
	s.telemetry.RecordCacheOp(operation, result, time.Since(start))
}

func (s *ChatService) absorb(ctx context.Context, op string, err error) {
	s.logger.WarnContext(ctx, "cache fault absorbed", "op", op, "error", err)
}

func trimPage(chatID string, page models.Page, limit int) (models.Page, error) {
	if limit <= 0 || limit >= len(page.Messages) {
		return page, nil
	}
	messages := page.Messages[:limit]
	last := messages[len(messages)-1]
	cursor, err := models.EncodeCursor(chatID, last.CreatedAt, last.ID)
	if err != nil {
		return models.Page{}, err
	}
	return models.Page{Messages: messages, NextCursor: cursor}, nil
}

func trimSummaries(chats []models.ChatSummary, limit int) []models.ChatSummary {
	if limit <= 0 || limit >= len(chats) {
		return chats
	}
	return chats[:limit]
}
