package ports

import (
	"context"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/core/domain"
)

type ChatService interface {
	CreateSession(ctx context.Context, userID, title string) (*domain.ChatSession, error)
	GetSession(ctx context.Context, chatID, userID string) (*domain.ChatSession, error)
	GetUserSessions(ctx context.Context, userID string, limit int) ([]*domain.ChatSession, error)
	RenameSession(ctx context.Context, chatID, userID, newTitle string) error
	DeleteSession(ctx context.Context, chatID, userID string) error
	
	ProcessMessage(ctx context.Context, msg *domain.Message) error
	GetHistory(ctx context.Context, chatID, userID string, page, pageSize int32) ([]*domain.Message, bool, error)
}