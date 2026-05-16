package services

import (
	"context"
	"sort"
	"time"

	"github.com/google/uuid"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/core/domain"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/core/ports"
	"go.uber.org/zap"
)

type ChatService struct {
	cache       ports.ChatCacheRepository
	stream      ports.ChatStreamRepository
	persistence ports.ChatPersistenceRepository
	logger      *zap.Logger
	metrics     ports.MetricsCollector
}

func NewChatService(
	cache ports.ChatCacheRepository,
	stream ports.ChatStreamRepository,
	persistence ports.ChatPersistenceRepository,
	logger *zap.Logger,
	metrics ports.MetricsCollector,
) *ChatService {
	return &ChatService{
		cache:       cache,
		stream:      stream,
		persistence: persistence,
		logger:      logger,
		metrics:     metrics,
	}
}

func (s *ChatService) withTimeout(ctx context.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(ctx, 10*time.Second)
}

func (s *ChatService) CreateSession(ctx context.Context, userID, title string) (*domain.ChatSession, error) {
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()

	if userID == "" || title == "" {
		return nil, domain.ErrInvalidInput
	}

	session := &domain.ChatSession{
		ID:        uuid.New().String(),
		UserID:    userID,
		Title:     title,
		CreatedAt: time.Now().UTC(),
		UpdatedAt: time.Now().UTC(),
	}

	if err := s.persistence.CreateChat(ctx, session); err != nil {
		s.logger.Error("failed to create chat session", zap.Error(err), zap.String("user_id", userID))
		s.metrics.IncDatabaseErrors("create_chat")
		return nil, err
	}

	return session, nil
}

func (s *ChatService) GetSession(ctx context.Context, chatID, userID string) (*domain.ChatSession, error) {
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()

	session, err := s.persistence.GetChat(ctx, chatID)
	if err != nil {
		return nil, domain.ErrNotFound
	}

	if session.UserID != userID {
		return nil, domain.ErrUnauthorized
	}

	return session, nil
}

func (s *ChatService) GetUserSessions(ctx context.Context, userID string) ([]*domain.ChatSession, error) {
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()

	if userID == "" {
		return nil, domain.ErrInvalidInput
	}
	return s.persistence.GetUserChats(ctx, userID, 50)
}

func (s *ChatService) RenameSession(ctx context.Context, chatID, userID, newTitle string) error {
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()

	if newTitle == "" {
		return domain.ErrInvalidInput
	}

	if _, err := s.GetSession(ctx, chatID, userID); err != nil {
		return err
	}

	return s.persistence.UpdateChatTitle(ctx, chatID, newTitle)
}

func (s *ChatService) DeleteSession(ctx context.Context, chatID, userID string) error {
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()

	if _, err := s.GetSession(ctx, chatID, userID); err != nil {
		return err
	}

	if err := s.persistence.DeleteChat(ctx, chatID); err != nil {
		s.logger.Error("failed to delete chat session", zap.Error(err), zap.String("chat_id", chatID))
		s.metrics.IncDatabaseErrors("delete_chat")
		return err
	}

	if err := s.cache.DeleteCache(ctx, chatID); err != nil {
		s.logger.Warn("failed to delete chat cache", zap.Error(err), zap.String("chat_id", chatID))
	}
	
	return nil
}

func (s *ChatService) ProcessMessage(ctx context.Context, msg *domain.Message) error {
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()

	if msg.ChatID == "" || msg.UserID == "" || msg.Content == "" {
		return domain.ErrInvalidInput
	}

	if _, err := s.GetSession(ctx, msg.ChatID, msg.UserID); err != nil {
		return err
	}

	if msg.ID == "" {
		msg.ID = uuid.New().String()
	}
	if msg.CreatedAt.IsZero() {
		msg.CreatedAt = time.Now().UTC()
	}

	if err := s.stream.Publish(ctx, msg); err != nil {
		s.logger.Error("failed to publish message to stream", zap.Error(err), zap.String("chat_id", msg.ChatID))
		s.metrics.IncStreamErrors("publish")
		return err
	}

	if err := s.cache.SaveToCache(ctx, msg); err != nil {
		s.logger.Warn("failed to save message to cache", zap.Error(err), zap.String("chat_id", msg.ChatID))
	}

	return nil
}

func (s *ChatService) GetHistory(ctx context.Context, chatID, userID string, page, pageSize int32) ([]*domain.Message, bool, error) {
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()

	if _, err := s.GetSession(ctx, chatID, userID); err != nil {
		return nil, false, err
	}

	if pageSize <= 0 {
		pageSize = 20
	}

	limit := int(pageSize)
	offset := int((page - 1) * pageSize)

	if page == 1 {
		hotMessages, err := s.cache.GetRecentMessages(ctx, chatID)
		if err == nil && len(hotMessages) > 0 {
			s.metrics.IncCacheHit()

			dbMessages, dbErr := s.persistence.GetHistory(ctx, chatID, offset, limit)
			if dbErr != nil {
				s.metrics.IncDatabaseErrors("get_history")
				return nil, false, dbErr
			}

			merged := mergeMessages(hotMessages, dbMessages)
			if len(merged) > limit {
				return merged[:limit], true, nil
			}

			hasMore := len(dbMessages) == limit
			return merged, hasMore, nil
		}
		s.metrics.IncCacheMiss()
		
		dbMessages, err := s.persistence.GetHistory(ctx, chatID, offset, limit)
		if err != nil {
			s.metrics.IncDatabaseErrors("get_history")
			return nil, false, err
		}

		if len(dbMessages) > 0 {
			go func(cid string, msgs []*domain.Message) {
				// Use a context that carries the tracing values but is not cancelled by the parent.
				// This ensures cache population continues even if the user disconnects.
				bgCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
				defer cancel()
				if err := s.cache.PopulateCache(bgCtx, cid, msgs); err != nil {
					s.logger.Warn("failed to populate cache in background", zap.Error(err), zap.String("chat_id", cid))
				}
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
