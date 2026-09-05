package usecase

import (
	"context"
	"errors"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/core/domain"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/core/ports"
	"go.uber.org/zap"
)

const (
	defaultPageSize = 20
	maxPageSize     = 100
	maxTitleLen     = 200
	maxContentLen   = 20000
	maxRoleLen      = 20
	defaultUserChatsLimit = 50
	maxUserChatsLimit     = 100
)

var validRoles = map[string]struct{}{
	"user":      {},
	"assistant": {},
	"system":    {},
	"tool":      {},
}

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

// withTimeout returns a context with a 10s timeout only if the parent has no deadline.
// This prevents nested calls (e.g. Rename -> GetSession) from extending the overall deadline.
func (s *ChatService) withTimeout(ctx context.Context) (context.Context, context.CancelFunc) {
	if _, ok := ctx.Deadline(); ok {
		return context.WithCancel(ctx)
	}
	return context.WithTimeout(ctx, 10*time.Second)
}

// fetchSession retrieves a chat session without applying a new timeout.
// Caller must have already applied withTimeout.
func (s *ChatService) fetchSession(ctx context.Context, chatID string) (*domain.ChatSession, error) {
	session, err := s.persistence.GetChat(ctx, chatID)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return nil, domain.ErrNotFound
		}
		if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
			return nil, err
		}
		s.logger.Error("failed to get chat session", zap.Error(err), zap.String("chat_id", chatID))
		s.metrics.IncDatabaseErrors("get_chat")
		return nil, err
	}
	if session == nil {
		return nil, domain.ErrNotFound
	}
	return session, nil
}

func (s *ChatService) CreateSession(ctx context.Context, userID, title string) (*domain.ChatSession, error) {
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()

	userID = strings.TrimSpace(userID)
	title = strings.TrimSpace(title)

	if userID == "" || title == "" {
		return nil, domain.ErrInvalidInput
	}
	if len(title) > maxTitleLen {
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
		if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
			return nil, err
		}
		s.logger.Error("failed to create chat session", zap.Error(err), zap.String("user_id", userID))
		s.metrics.IncDatabaseErrors("create_chat")
		return nil, err
	}

	return session, nil
}

func (s *ChatService) GetSession(ctx context.Context, chatID, userID string) (*domain.ChatSession, error) {
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()

	chatID = strings.TrimSpace(chatID)
	userID = strings.TrimSpace(userID)
	if chatID == "" || userID == "" {
		return nil, domain.ErrInvalidInput
	}

	session, err := s.fetchSession(ctx, chatID)
	if err != nil {
		return nil, err
	}

	if session.UserID != userID {
		return nil, domain.ErrUnauthorized
	}

	return session, nil
}

func (s *ChatService) GetUserSessions(ctx context.Context, userID string, limit int) ([]*domain.ChatSession, error) {
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()

	userID = strings.TrimSpace(userID)
	if userID == "" {
		return nil, domain.ErrInvalidInput
	}
	if limit <= 0 {
		limit = defaultUserChatsLimit
	}
	if limit > maxUserChatsLimit {
		limit = maxUserChatsLimit
	}
	sessions, err := s.persistence.GetUserChats(ctx, userID, limit)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
			return nil, err
		}
		s.logger.Error("failed to get user chats", zap.Error(err), zap.String("user_id", userID))
		s.metrics.IncDatabaseErrors("get_user_chats")
		return nil, err
	}
	if sessions == nil {
		return []*domain.ChatSession{}, nil
	}
	return sessions, nil
}

// GetUserSessionsLegacy is kept for backward compatibility with callers that do not supply limit.
// Deprecated: use GetUserSessions with explicit limit.
func (s *ChatService) GetUserSessionsLegacy(ctx context.Context, userID string) ([]*domain.ChatSession, error) {
	return s.GetUserSessions(ctx, userID, defaultUserChatsLimit)
}

func (s *ChatService) RenameSession(ctx context.Context, chatID, userID, newTitle string) error {
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()

	newTitle = strings.TrimSpace(newTitle)
	chatID = strings.TrimSpace(chatID)
	userID = strings.TrimSpace(userID)

	if newTitle == "" || chatID == "" || userID == "" {
		return domain.ErrInvalidInput
	}
	if len(newTitle) > maxTitleLen {
		return domain.ErrInvalidInput
	}

	session, err := s.fetchSession(ctx, chatID)
	if err != nil {
		return err
	}
	if session.UserID != userID {
		return domain.ErrUnauthorized
	}

	if err := s.persistence.UpdateChatTitle(ctx, chatID, newTitle); err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return domain.ErrNotFound
		}
		if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
			return err
		}
		s.logger.Error("failed to rename chat session", zap.Error(err), zap.String("chat_id", chatID))
		s.metrics.IncDatabaseErrors("update_chat_title")
		return err
	}

	return nil
}

func (s *ChatService) DeleteSession(ctx context.Context, chatID, userID string) error {
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()

	chatID = strings.TrimSpace(chatID)
	userID = strings.TrimSpace(userID)
	if chatID == "" || userID == "" {
		return domain.ErrInvalidInput
	}

	session, err := s.fetchSession(ctx, chatID)
	if err != nil {
		return err
	}
	if session.UserID != userID {
		return domain.ErrUnauthorized
	}

	if err := s.persistence.DeleteChat(ctx, chatID); err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return domain.ErrNotFound
		}
		if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
			return err
		}
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

	if msg == nil {
		return domain.ErrInvalidInput
	}
	msg.ChatID = strings.TrimSpace(msg.ChatID)
	msg.UserID = strings.TrimSpace(msg.UserID)
	msg.Content = strings.TrimSpace(msg.Content)
	msg.Role = strings.TrimSpace(msg.Role)

	if msg.ChatID == "" || msg.UserID == "" || msg.Content == "" {
		return domain.ErrInvalidInput
	}
	if len(msg.Content) > maxContentLen {
		return domain.ErrInvalidInput
	}
	if msg.Role != "" {
		if len(msg.Role) > maxRoleLen {
			return domain.ErrInvalidInput
		}
		if _, ok := validRoles[msg.Role]; !ok {
			return domain.ErrInvalidInput
		}
	} else {
		msg.Role = "user"
	}

	session, err := s.fetchSession(ctx, msg.ChatID)
	if err != nil {
		return err
	}
	if session.UserID != msg.UserID {
		return domain.ErrUnauthorized
	}

	if msg.ID == "" {
		msg.ID = uuid.New().String()
	}
	if msg.CreatedAt.IsZero() {
		msg.CreatedAt = time.Now().UTC()
	} else {
		msg.CreatedAt = msg.CreatedAt.UTC()
		// Reject timestamps far in the future (clock skew / millis confusion)
		if msg.CreatedAt.After(time.Now().UTC().Add(5 * time.Minute)) {
			return domain.ErrInvalidInput
		}
	}

	if err := s.stream.Publish(ctx, msg); err != nil {
		if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
			return err
		}
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

	chatID = strings.TrimSpace(chatID)
	userID = strings.TrimSpace(userID)
	if chatID == "" || userID == "" {
		return nil, false, domain.ErrInvalidInput
	}

	session, err := s.fetchSession(ctx, chatID)
	if err != nil {
		return nil, false, err
	}
	if session.UserID != userID {
		return nil, false, domain.ErrUnauthorized
	}

	// Normalize pagination
	if page <= 0 {
		page = 1
	}
	if pageSize <= 0 {
		pageSize = defaultPageSize
	}
	if pageSize > maxPageSize {
		pageSize = maxPageSize
	}

	limit := int(pageSize)
	// Use int64 to avoid overflow on (page-1)*pageSize
	offset64 := int64(page-1) * int64(pageSize)
	if offset64 > int64(1_000_000) {
		// Guard against absurd offsets that would force huge DB scans
		return []*domain.Message{}, false, nil
	}
	offset := int(offset64)

	if page == 1 {
		hotMessages, err := s.cache.GetRecentMessages(ctx, chatID)
		if err == nil && len(hotMessages) > 0 {
			s.metrics.IncCacheHit()

			dbMessages, dbErr := s.persistence.GetHistory(ctx, chatID, offset, limit)
			if dbErr != nil {
				if errors.Is(dbErr, context.DeadlineExceeded) || errors.Is(dbErr, context.Canceled) {
					return nil, false, dbErr
				}
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
		if err != nil {
			// Only log unexpected cache errors; cache miss is not an error path for most implementations
			// but we treat any error as miss. Do not propagate.
			s.logger.Warn("cache retrieval failed, falling back to DB", zap.Error(err), zap.String("chat_id", chatID))
		}
		s.metrics.IncCacheMiss()

		dbMessages, dbErr := s.persistence.GetHistory(ctx, chatID, offset, limit)
		if dbErr != nil {
			if errors.Is(dbErr, context.DeadlineExceeded) || errors.Is(dbErr, context.Canceled) {
				return nil, false, dbErr
			}
			s.metrics.IncDatabaseErrors("get_history")
			return nil, false, dbErr
		}

		if len(dbMessages) > 0 {
			dbCopy := dbMessages
			cid := chatID
			go func(cid string, msgs []*domain.Message) {
				// Use a context that carries tracing values but is not cancelled by the parent.
				bgCtx, bgCancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
				defer bgCancel()
				if err := s.cache.PopulateCache(bgCtx, cid, msgs); err != nil {
					s.logger.Warn("failed to populate cache in background", zap.Error(err), zap.String("chat_id", cid))
				}
			}(cid, dbCopy)
		}

		hasMore := len(dbMessages) == limit
		if dbMessages == nil {
			dbMessages = []*domain.Message{}
		}
		return dbMessages, hasMore, nil
	}

	coldMessages, err := s.persistence.GetHistory(ctx, chatID, offset, limit)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
			return nil, false, err
		}
		s.metrics.IncDatabaseErrors("get_history")
		return nil, false, err
	}
	if coldMessages == nil {
		coldMessages = []*domain.Message{}
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
		if msg.ID == "" {
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
		if msg.ID == "" {
			continue
		}
		if _, exists := seen[msg.ID]; exists {
			continue
		}
		seen[msg.ID] = struct{}{}
		merged = append(merged, msg)
	}

	sort.SliceStable(merged, func(i, j int) bool {
		if merged[i].CreatedAt.Equal(merged[j].CreatedAt) {
			return merged[i].ID > merged[j].ID
		}
		return merged[i].CreatedAt.After(merged[j].CreatedAt)
	})

	return merged
}
