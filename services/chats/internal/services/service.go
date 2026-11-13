// Package services holds the chats use cases, the types they work on, and the
// contracts they code against.
package services

import (
	"context"
	"log/slog"
	"time"
)

// Service is the chats use-case surface the transport layer codes against.
type Service interface {
	// CreateChat opens a chat and stores the message that opened it.
	CreateChat(ctx context.Context, ownerID, initialMessage string) (Chat, error)
	// GetChat returns the chat meta with its head page and the cursor that
	// chains to the next one.
	GetChat(ctx context.Context, ownerID, chatID string) (Chat, []Message, string, error)
	// ListChats returns the owner's chats newest-first.
	ListChats(ctx context.Context, ownerID string, limit int) ([]ChatSummary, error)
	// RenameChat sets a chat's title.
	RenameChat(ctx context.Context, ownerID, chatID, title string) (ChatSummary, error)
	// DeleteChat deletes a chat and its messages.
	DeleteChat(ctx context.Context, ownerID, chatID string) error
	// SaveUserMessage stores a message the user sent.
	SaveUserMessage(ctx context.Context, ownerID, chatID, messageID, content string, createdAt time.Time) (Message, error)
	// SaveAnalysisMessage stores the analysis state of a message.
	SaveAnalysisMessage(ctx context.Context, ownerID, chatID, messageID string, createdAt time.Time, analysis *Analysis) (Message, error)
	// GetChatHistory pages a chat's history newest-first.
	GetChatHistory(ctx context.Context, ownerID, chatID, cursor string, limit int) ([]Message, string, error)
}

// ChatService owns the chat business rules.
type ChatService struct {
	repo   Repository
	cache  Cache
	logger *slog.Logger
}

// NewChatService builds the service over its data access and its cache.
func NewChatService(repo Repository, cache Cache, logger *slog.Logger) *ChatService {
	return &ChatService{repo: repo, cache: cache, logger: logger}
}

var _ Service = (*ChatService)(nil)
