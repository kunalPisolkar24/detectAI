// Package services holds the chats use cases and the contract the transport
// layer codes against.
package services

import (
	"context"
	"log/slog"
	"time"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/cache"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/models"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/repository"
)

// Service is the chats use-case surface the transport layer codes against.
type Service interface {
	CreateChat(ctx context.Context, ownerID, initialMessage string) (models.Chat, error)
	GetChat(ctx context.Context, ownerID, chatID string) (models.Chat, []models.Message, string, error)
	ListChats(ctx context.Context, ownerID string, limit int) ([]models.ChatSummary, error)
	RenameChat(ctx context.Context, ownerID, chatID, title string) (models.ChatSummary, error)
	DeleteChat(ctx context.Context, ownerID, chatID string) error
	SaveUserMessage(ctx context.Context, ownerID, chatID, messageID, content string, createdAt time.Time) (models.Message, error)
	SaveAnalysisMessage(ctx context.Context, ownerID, chatID, messageID string, createdAt time.Time, analysis *models.Analysis) (models.Message, error)
	GetChatHistory(ctx context.Context, ownerID, chatID, cursor string, limit int) ([]models.Message, string, error)
}

type ChatService struct {
	repo   repository.Repository
	cache  cache.Cache
	logger *slog.Logger
}

func NewChatService(repo repository.Repository, entries cache.Cache, logger *slog.Logger) *ChatService {
	return &ChatService{repo: repo, cache: entries, logger: logger}
}

var _ Service = (*ChatService)(nil)
