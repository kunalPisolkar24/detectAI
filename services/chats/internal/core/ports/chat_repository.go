package ports

import (
	"context"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/core/domain"
)

type ChatCacheRepository interface {
	SaveToCache(ctx context.Context, msg *domain.Message) error
	GetRecentMessages(ctx context.Context, chatID string) ([]*domain.Message, error)
}

type ChatStreamRepository interface {
	Publish(ctx context.Context, msg *domain.Message) error
}

type ChatPersistenceRepository interface {
	CreateChat(ctx context.Context, chat *domain.ChatSession) error
	GetChat(ctx context.Context, chatID string) (*domain.ChatSession, error)
	BulkUpsertMessages(ctx context.Context, messages []*domain.Message) error
	GetHistory(ctx context.Context, chatID string, offset, limit int) ([]*domain.Message, error)
}