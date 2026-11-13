package core

import (
	"context"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/cache"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/store"
)

// cachedChat returns the chat meta, cache first. A cached chat carries its
// owner, so the ownership rule holds on a hit as well as on a miss.
func (s *ChatService) cachedChat(ctx context.Context, ownerID, chatID string) (store.Chat, error) {
	cached, found, err := s.cache.Chat(ctx, chatID)
	if err != nil {
		s.absorb("chat read", err)
	} else if found {
		if cached.UserID != ownerID {
			return store.Chat{}, store.ErrNotFound
		}
		return cached, nil
	}

	chat, err := s.repo.Chat(ctx, ownerID, chatID)
	if err != nil {
		return store.Chat{}, err
	}
	s.putChat(ctx, chat)
	return chat, nil
}

// cachedList returns the owner's chats newest-first, cache first, trimmed to
// the requested limit.
func (s *ChatService) cachedList(ctx context.Context, ownerID string, limit int) ([]store.ChatSummary, error) {
	cached, found, err := s.cache.ChatList(ctx, ownerID)
	if err != nil {
		s.absorb("chat list read", err)
	} else if found {
		return trimSummaries(cached, limit), nil
	}

	chats, err := s.repo.Chats(ctx, ownerID, store.DefaultChatsLimit)
	if err != nil {
		return nil, err
	}
	s.putChatList(ctx, ownerID, chats)
	return trimSummaries(chats, limit), nil
}

// headPage returns a chat's head page, cache first, trimmed to the requested
// limit. The cache always holds a full page, so a smaller request trims it
// and the larger one reads the source.
func (s *ChatService) headPage(ctx context.Context, ownerID, chatID string, limit int) (cache.Page, error) {
	cached, found, err := s.cache.Head(ctx, chatID)
	if err != nil {
		s.absorb("head read", err)
	} else if found {
		return trimPage(chatID, cached, limit)
	}

	messages, next, err := s.repo.ChatHistory(ctx, ownerID, chatID, "", store.DefaultHistoryLimit)
	if err != nil {
		return cache.Page{}, err
	}
	page := cache.Page{Messages: messages, NextCursor: next}
	s.putHead(ctx, chatID, page)
	return trimPage(chatID, page, limit)
}

// invalidateChat drops the chat's meta and head entries and the owner's list.
func (s *ChatService) invalidateChat(ctx context.Context, chatID, ownerID string) {
	if err := s.cache.InvalidateChat(ctx, chatID); err != nil {
		s.absorb("chat invalidation", err)
	}
	s.invalidateOwner(ctx, ownerID)
}

// invalidateMeta drops the chat's meta entry and the owner's list.
func (s *ChatService) invalidateMeta(ctx context.Context, chatID, ownerID string) {
	if err := s.cache.InvalidateMeta(ctx, chatID); err != nil {
		s.absorb("chat meta invalidation", err)
	}
	s.invalidateOwner(ctx, ownerID)
}

// invalidateOwner drops the owner's list.
func (s *ChatService) invalidateOwner(ctx context.Context, ownerID string) {
	if err := s.cache.InvalidateOwner(ctx, ownerID); err != nil {
		s.absorb("owner invalidation", err)
	}
}

func (s *ChatService) putChat(ctx context.Context, chat store.Chat) {
	if err := s.cache.PutChat(ctx, chat); err != nil {
		s.absorb("chat write", err)
	}
}

func (s *ChatService) putChatList(ctx context.Context, ownerID string, chats []store.ChatSummary) {
	if err := s.cache.PutChatList(ctx, ownerID, chats); err != nil {
		s.absorb("chat list write", err)
	}
}

func (s *ChatService) putHead(ctx context.Context, chatID string, page cache.Page) {
	if err := s.cache.PutHead(ctx, chatID, page); err != nil {
		s.absorb("head write", err)
	}
}

// absorb drops a cache fault: a cache fault never fails an RPC.
func (s *ChatService) absorb(op string, err error) {
	s.logger.Warn("cache fault absorbed", "op", op, "error", err)
}

// trimPage trims a full page to the requested limit and derives the cursor
// that chains to what is left of it.
func trimPage(chatID string, page cache.Page, limit int) (cache.Page, error) {
	if limit <= 0 || limit >= len(page.Messages) {
		return page, nil
	}
	messages := page.Messages[:limit]
	last := messages[len(messages)-1]
	cursor, err := store.EncodeCursor(chatID, last.CreatedAt, last.ID)
	if err != nil {
		return cache.Page{}, err
	}
	return cache.Page{Messages: messages, NextCursor: cursor}, nil
}

// trimSummaries trims a cached list to the requested limit.
func trimSummaries(chats []store.ChatSummary, limit int) []store.ChatSummary {
	if limit <= 0 || limit >= len(chats) {
		return chats
	}
	return chats[:limit]
}
