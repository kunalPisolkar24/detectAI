package core

import (
	"context"
	"time"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/store"
)

// Service is the chats use-case surface the transport layer codes against.
type Service interface {
	// CreateChat opens a chat and stores the message that opened it.
	CreateChat(ctx context.Context, ownerID, initialMessage string) (store.Chat, error)
	// GetChat returns the chat meta with its head page and the cursor that
	// chains to the next one.
	GetChat(ctx context.Context, ownerID, chatID string) (store.Chat, []store.Message, string, error)
	// ListChats returns the owner's chats newest-first.
	ListChats(ctx context.Context, ownerID string, limit int) ([]store.ChatSummary, error)
	// RenameChat sets a chat's title.
	RenameChat(ctx context.Context, ownerID, chatID, title string) (store.ChatSummary, error)
	// DeleteChat deletes a chat and its messages.
	DeleteChat(ctx context.Context, ownerID, chatID string) error
	// SaveUserMessage stores a message the user sent.
	SaveUserMessage(ctx context.Context, ownerID, chatID, messageID, content string, createdAt time.Time) (store.Message, error)
	// SaveAnalysisMessage stores the analysis state of a message.
	SaveAnalysisMessage(ctx context.Context, ownerID, chatID, messageID string, createdAt time.Time, analysis *store.Analysis) (store.Message, error)
	// GetChatHistory pages a chat's history newest-first.
	GetChatHistory(ctx context.Context, ownerID, chatID, cursor string, limit int) ([]store.Message, string, error)
}

var _ Service = (*ChatService)(nil)
