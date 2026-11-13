// Package repository owns the chat data access over MongoDB; it implements the Repository contract.
package repository

import (
	"context"
	"errors"
	"fmt"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	driver "go.mongodb.org/mongo-driver/v2/mongo"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/models"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/observability"
)

const (
	chatsCollection    = "chats"
	messagesCollection = "messages"
)

// Repository is the chat data-access contract the service codes against. Every
// method threads the owner's id — a chat missing or not owned answers models.ErrNotFound.
type Repository interface {
	// CreateChat inserts the chat shell; the service derives the title and saves the first message.
	CreateChat(ctx context.Context, ownerID, title string) (models.Chat, error)
	Chat(ctx context.Context, ownerID, chatID string) (models.Chat, error)
	Chats(ctx context.Context, ownerID string, limit int) ([]models.ChatSummary, error)
	RenameChat(ctx context.Context, ownerID, chatID, title string) (models.ChatSummary, error)
	// DeleteChat runs without a transaction: re-deleting an already-deleted chat succeeds,
	// another owner's chat is models.ErrNotFound.
	DeleteChat(ctx context.Context, ownerID, chatID string) error
	// SaveUserMessage is insert-only: a duplicate id replays the existing message, never overwrites it.
	SaveUserMessage(ctx context.Context, ownerID string, msg models.Message) (models.Message, error)
	// SaveAnalysisMessage upserts the analysis state machine keyed on id: created_at
	// is set once, a foreign chat id is models.ErrNotFound, and a non-replay write
	// into a terminal state is models.ErrConflict.
	SaveAnalysisMessage(ctx context.Context, ownerID string, msg models.Message) (models.Message, error)
	// ChatHistory pages newest-first on the (created_at, _id) keyset; an empty cursor
	// is the first page and the next-cursor return is empty at the end.
	ChatHistory(ctx context.Context, ownerID, chatID, cursor string, limit int) ([]models.Message, string, error)
}

type Mongo struct {
	chats     *driver.Collection
	messages  *driver.Collection
	telemetry observability.Telemetry
}

var _ Repository = (*Mongo)(nil)

// Ensures the data-model indexes.
func New(ctx context.Context, database *driver.Database, telemetry observability.Telemetry) (*Mongo, error) {
	if err := ensureIndexes(ctx, database); err != nil {
		return nil, fmt.Errorf("repository: ensure indexes: %w", err)
	}
	return &Mongo{
		chats:     database.Collection(chatsCollection),
		messages:  database.Collection(messagesCollection),
		telemetry: telemetry,
	}, nil
}

// record counts one datastore operation and times it.
func (r *Mongo) record(operation string, err error, start time.Time) {
	r.telemetry.RecordDatastoreOp(operation, datastoreResult(err), time.Since(start))
}

// datastoreResult classifies a repository call's outcome.
func datastoreResult(err error) observability.DatastoreResult {
	switch {
	case err == nil:
		return observability.DatastoreOK
	case errors.Is(err, models.ErrNotFound):
		return observability.DatastoreNotFound
	case errors.Is(err, models.ErrConflict):
		return observability.DatastoreConflict
	case errors.Is(err, models.ErrInvalidCursor):
		return observability.DatastoreInvalidCursor
	case errors.Is(err, models.ErrUnavailable):
		return observability.DatastoreUnavailable
	default:
		return observability.DatastoreError
	}
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
