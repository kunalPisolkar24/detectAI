package services

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/core/domain"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/core/ports"
	"github.com/kunalPisolkar24/detectAI/services/chats/pkg/metrics"
)

type ChatService struct {
	cache       ports.ChatCacheRepository
	stream      ports.ChatStreamRepository
	persistence ports.ChatPersistenceRepository
}

func NewChatService(
	cache ports.ChatCacheRepository,
	stream ports.ChatStreamRepository,
	persistence ports.ChatPersistenceRepository,
) *ChatService {
	return &ChatService{
		cache:       cache,
		stream:      stream,
		persistence: persistence,
	}
}

func (s *ChatService) CreateSession(ctx context.Context, userID, title string) (*domain.ChatSession, error) {
	session := &domain.ChatSession{
		ID:        uuid.New().String(),
		UserID:    userID,
		Title:     title,
		CreatedAt: time.Now().UTC(),
		UpdatedAt: time.Now().UTC(),
	}

	if err := s.persistence.CreateChat(ctx, session); err != nil {
		return nil, err
	}

	return session, nil
}

func (s *ChatService) ProcessMessage(ctx context.Context, msg *domain.Message) error {
	chat, err := s.persistence.GetChat(ctx, msg.ChatID)
	if err != nil {
		return err
	}
	if chat.UserID != msg.UserID {
		return errors.New("unauthorized: user does not own this chat session")
	}

	if msg.ID == "" {
		msg.ID = uuid.New().String()
	}
	if msg.CreatedAt.IsZero() {
		msg.CreatedAt = time.Now().UTC()
	}

	if err := s.stream.Publish(ctx, msg); err != nil {
		return err
	}

	_ = s.cache.SaveToCache(ctx, msg)

	return nil
}

func (s *ChatService) GetHistory(ctx context.Context, chatID string, page, pageSize int32) ([]*domain.Message, bool, error) {
	if pageSize <= 0 {
		pageSize = 20
	}

	limit := int(pageSize)
	offset := int((page - 1) * pageSize)

	if page == 1 {
		hotMessages, err := s.cache.GetRecentMessages(ctx, chatID)
		if err == nil && len(hotMessages) >= limit {
			metrics.CacheHits.Inc()
			return hotMessages[:limit], true, nil
		}
		metrics.CacheMisses.Inc()
	}

	coldMessages, err := s.persistence.GetHistory(ctx, chatID, offset, limit)
	if err != nil {
		return nil, false, err
	}

	hasMore := len(coldMessages) == limit
	return coldMessages, hasMore, nil
}