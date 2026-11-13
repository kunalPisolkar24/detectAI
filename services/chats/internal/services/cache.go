package services

import (
	"context"
	"time"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/models"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/observability"
)

// cachedChat returns the chat meta, cache first. A cached chat carries its owner, so the ownership rule holds on a hit as well as on a miss.
func (s *ChatService) cachedChat(ctx context.Context, ownerID, chatID string) (models.Chat, error) {
	start := time.Now()
	cached, found, err := s.cache.Chat(ctx, chatID)
	s.recordCacheRead(observability.CacheOperationChat, found, err, start)
	if err != nil {
		s.absorb("chat read", err)
	} else if found {
		if cached.UserID != ownerID {
			return models.Chat{}, models.ErrNotFound
		}
		return cached, nil
	}

	chat, err := s.repo.Chat(ctx, ownerID, chatID)
	if err != nil {
		return models.Chat{}, err
	}
	s.putChat(ctx, chat)
	return chat, nil
}

func (s *ChatService) cachedList(ctx context.Context, ownerID string, limit int) ([]models.ChatSummary, error) {
	start := time.Now()
	cached, found, err := s.cache.ChatList(ctx, ownerID)
	s.recordCacheRead(observability.CacheOperationChatList, found, err, start)
	if err != nil {
		s.absorb("chat list read", err)
	} else if found {
		return trimSummaries(cached, limit), nil
	}

	chats, err := s.repo.Chats(ctx, ownerID, models.DefaultChatsLimit)
	if err != nil {
		return nil, err
	}
	s.putChatList(ctx, ownerID, chats)
	return trimSummaries(chats, limit), nil
}

// headPage returns a chat's head page, cache first, trimmed to the requested
// limit. The cache always holds a full page, so a smaller request trims it
// and the larger one reads the source.
func (s *ChatService) headPage(ctx context.Context, ownerID, chatID string, limit int) (models.Page, error) {
	start := time.Now()
	cached, found, err := s.cache.Head(ctx, chatID)
	s.recordCacheRead(observability.CacheOperationHead, found, err, start)
	if err != nil {
		s.absorb("head read", err)
	} else if found {
		return trimPage(chatID, cached, limit)
	}

	messages, next, err := s.repo.ChatHistory(ctx, ownerID, chatID, "", models.DefaultHistoryLimit)
	if err != nil {
		return models.Page{}, err
	}
	page := models.Page{Messages: messages, NextCursor: next}
	s.putHead(ctx, chatID, page)
	return trimPage(chatID, page, limit)
}

func (s *ChatService) invalidateChat(ctx context.Context, chatID, ownerID string) {
	start := time.Now()
	err := s.cache.InvalidateChat(ctx, chatID)
	s.recordCacheWrite(observability.CacheOperationInvalidateChat, err, start)
	if err != nil {
		s.absorb("chat invalidation", err)
	}
	s.invalidateOwner(ctx, ownerID)
}

func (s *ChatService) invalidateMeta(ctx context.Context, chatID, ownerID string) {
	start := time.Now()
	err := s.cache.InvalidateMeta(ctx, chatID)
	s.recordCacheWrite(observability.CacheOperationInvalidateMeta, err, start)
	if err != nil {
		s.absorb("chat meta invalidation", err)
	}
	s.invalidateOwner(ctx, ownerID)
}

func (s *ChatService) invalidateOwner(ctx context.Context, ownerID string) {
	start := time.Now()
	err := s.cache.InvalidateOwner(ctx, ownerID)
	s.recordCacheWrite(observability.CacheOperationInvalidateOwner, err, start)
	if err != nil {
		s.absorb("owner invalidation", err)
	}
}

func (s *ChatService) putChat(ctx context.Context, chat models.Chat) {
	start := time.Now()
	err := s.cache.PutChat(ctx, chat)
	s.recordCacheWrite(observability.CacheOperationPutChat, err, start)
	if err != nil {
		s.absorb("chat write", err)
	}
}

func (s *ChatService) putChatList(ctx context.Context, ownerID string, chats []models.ChatSummary) {
	start := time.Now()
	err := s.cache.PutChatList(ctx, ownerID, chats)
	s.recordCacheWrite(observability.CacheOperationPutChatList, err, start)
	if err != nil {
		s.absorb("chat list write", err)
	}
}

func (s *ChatService) putHead(ctx context.Context, chatID string, page models.Page) {
	start := time.Now()
	err := s.cache.PutHead(ctx, chatID, page)
	s.recordCacheWrite(observability.CacheOperationPutHead, err, start)
	if err != nil {
		s.absorb("head write", err)
	}
}

// recordCacheRead counts one cache lookup: a hit, a miss, or a fault the read
// absorbs.
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

// recordCacheWrite counts one cache write or invalidation.
func (s *ChatService) recordCacheWrite(operation string, err error, start time.Time) {
	result := observability.CacheOK
	if err != nil {
		result = observability.CacheError
	}
	s.telemetry.RecordCacheOp(operation, result, time.Since(start))
}

// absorb drops a cache fault: a cache fault never fails an RPC.
func (s *ChatService) absorb(op string, err error) {
	s.logger.Warn("cache fault absorbed", "op", op, "error", err)
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
