// Package repository owns the chat data access over MongoDB; it implements
// the Repository contract.
package repository

import (
	"context"
	"fmt"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	driver "go.mongodb.org/mongo-driver/v2/mongo"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/models"
)

const (
	chatsCollection    = "chats"
	messagesCollection = "messages"
)

// Repository is the chat data-access contract the service codes against.
// Every method threads the owner's id — ownership is a data invariant, so a
// chat missing or not owned answers models.ErrNotFound.
type Repository interface {
	// CreateChat inserts the chat shell — the service derives the title from
	// the initial message and saves the first user message through SaveUserMessage.
	CreateChat(ctx context.Context, ownerID, title string) (models.Chat, error)
	// Chat returns the owner-scoped chat meta.
	Chat(ctx context.Context, ownerID, chatID string) (models.Chat, error)
	// Chats lists the owner's chats newest-first by updated_at; a positive limit applies.
	Chats(ctx context.Context, ownerID string, limit int) ([]models.ChatSummary, error)
	// RenameChat sets the title and bumps updated_at, returning the summary.
	RenameChat(ctx context.Context, ownerID, chatID, title string) (models.ChatSummary, error)
	// DeleteChat deletes the chat then its messages without a transaction —
	// re-deleting an already-deleted chat succeeds, another owner's chat is models.ErrNotFound.
	DeleteChat(ctx context.Context, ownerID, chatID string) error
	// SaveUserMessage is insert-only — a duplicate id is a replay returning
	// the existing message, never overwritten.
	SaveUserMessage(ctx context.Context, ownerID string, msg models.Message) (models.Message, error)
	// SaveAnalysisMessage upserts the analysis state machine keyed on id —
	// created_at is set once, a foreign chat id is models.ErrNotFound, and a
	// non-replay write into a terminal state is models.ErrConflict.
	SaveAnalysisMessage(ctx context.Context, ownerID string, msg models.Message) (models.Message, error)
	// ChatHistory pages newest-first on the (created_at, _id) keyset — an
	// empty cursor is the first page and the next-cursor return is empty at the end.
	ChatHistory(ctx context.Context, ownerID, chatID, cursor string, limit int) ([]models.Message, string, error)
}

// Mongo is the mongo-backed chat data access.
type Mongo struct {
	chats    *driver.Collection
	messages *driver.Collection
}

var _ Repository = (*Mongo)(nil)

// New builds the data access over a connected database handle and ensures the
// data-model indexes.
func New(ctx context.Context, database *driver.Database) (*Mongo, error) {
	if err := ensureIndexes(ctx, database); err != nil {
		return nil, fmt.Errorf("repository: ensure indexes: %w", err)
	}
	return &Mongo{
		chats:    database.Collection(chatsCollection),
		messages: database.Collection(messagesCollection),
	}, nil
}

// stamp truncates a timestamp to the precision bson stores datetimes at, so a
// timestamp the repository hands back matches the one it wrote.
func stamp(value time.Time) time.Time {
	return value.UTC().Truncate(time.Millisecond)
}

// wrap classifies a driver fault: an unreachable source is the shared
// sentinel, so the transport layer can map it without the driver.
func wrap(op string, err error) error {
	if driver.IsNetworkError(err) || driver.IsTimeout(err) {
		return fmt.Errorf("repository: %s: %w: %w", op, models.ErrUnavailable, err)
	}
	return fmt.Errorf("repository: %s: %w", op, err)
}

// ensureIndexes creates the data-model indexes; an identical existing index is a server no-op.
func ensureIndexes(ctx context.Context, database *driver.Database) error {
	_, err := database.Collection(chatsCollection).Indexes().CreateMany(ctx, []driver.IndexModel{
		{Keys: bson.D{{Key: "user_id", Value: 1}, {Key: "updated_at", Value: -1}}},
	})
	if err != nil {
		return fmt.Errorf("chats: %w", err)
	}
	_, err = database.Collection(messagesCollection).Indexes().CreateMany(ctx, []driver.IndexModel{
		{Keys: bson.D{{Key: "chat_id", Value: 1}, {Key: "created_at", Value: -1}, {Key: "_id", Value: -1}}},
	})
	if err != nil {
		return fmt.Errorf("messages: %w", err)
	}
	return nil
}
