package services

import (
	"context"
	"errors"
	"sort"
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

func (s *ChatService) GetSession(ctx context.Context, chatID string) (*domain.ChatSession, error) {
	return s.persistence.GetChat(ctx, chatID)
}

func (s *ChatService) GetUserSessions(ctx context.Context, userID string) ([]*domain.ChatSession, error) {
	return s.persistence.GetUserChats(ctx, userID, 50)
}

func (s *ChatService) RenameSession(ctx context.Context, chatID, newTitle string) error {
	if newTitle == "" {
		return errors.New("title cannot be empty")
	}
	return s.persistence.UpdateChatTitle(ctx, chatID, newTitle)
}

func (s *ChatService) DeleteSession(ctx context.Context, chatID string) error {
	if err := s.persistence.DeleteChat(ctx, chatID); err != nil {
		return err
	}

	_ = s.cache.DeleteCache(ctx, chatID)
	
	return nil
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

	_ = s.persistence.UpdateChatTitle(ctx, msg.ChatID, chat.Title)

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
		if err == nil && len(hotMessages) > 0 {
			metrics.CacheHits.Inc()

			dbMessages, dbErr := s.persistence.GetHistory(ctx, chatID, offset, limit)
			if dbErr != nil {
				return nil, false, dbErr
			}

			merged := mergeMessages(hotMessages, dbMessages)
			if len(merged) > limit {
				return merged[:limit], true, nil
			}

			hasMore := len(dbMessages) == limit
			return merged, hasMore, nil
		}
		metrics.CacheMisses.Inc()
		
		dbMessages, err := s.persistence.GetHistory(ctx, chatID, offset, limit)
		if err != nil {
			return nil, false, err
		}

		if len(dbMessages) > 0 {
			go func(cid string, msgs []*domain.Message) {
				bgCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				defer cancel()
				_ = s.cache.PopulateCache(bgCtx, cid, msgs)
			}(chatID, dbMessages)
		}

		hasMore := len(dbMessages) == limit
		return dbMessages, hasMore, nil
	}

	coldMessages, err := s.persistence.GetHistory(ctx, chatID, offset, limit)
	if err != nil {
		return nil, false, err
	}

	hasMore := len(coldMessages) == limit
	return coldMessages, hasMore, nil
}

func mergeMessages(primary []*domain.Message, secondary []*domain.Message) []*domain.Message {
	seen := make(map[string]struct{}, len(primary)+len(secondary))
	merged := make([]*domain.Message, 0, len(primary)+len(secondary))

	for _, msg := range primary {
		if msg == nil {
			continue
		}
		if _, exists := seen[msg.ID]; exists {
			continue
		}

		seen[msg.ID] = struct{}{}
		merged = append(merged, msg)
	}

	for _, msg := range secondary {
		if msg == nil {
			continue
		}
		if _, exists := seen[msg.ID]; exists {
			continue
		}

		seen[msg.ID] = struct{}{}
		merged = append(merged, msg)
	}

	sort.SliceStable(merged, func(i, j int) bool {
		return merged[i].CreatedAt.After(merged[j].CreatedAt)
	})

	return merged
}
