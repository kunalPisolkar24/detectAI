package ports

import (
	"context"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/core/domain"
)

type ChatService interface {
	CreateSession(ctx context.Context, userID, title string) (*domain.ChatSession, error)
	ProcessMessage(ctx context.Context, msg *domain.Message) error
	GetHistory(ctx context.Context, chatID string, page, pageSize int32) ([]*domain.Message, bool, error)
}
