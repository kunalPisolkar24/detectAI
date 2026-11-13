// Package repository owns the chat data access over MongoDB; it implements
// the services.Repository contract.
package repository

import (
	"fmt"
	"time"

	driver "go.mongodb.org/mongo-driver/v2/mongo"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/services"
)

const (
	chatsCollection    = "chats"
	messagesCollection = "messages"
)

// Repository is the mongo-backed chat data access.
type Repository struct {
	chats    *driver.Collection
	messages *driver.Collection
}

var _ services.Repository = (*Repository)(nil)

// New builds the repository over a connected database handle.
func New(database *driver.Database) *Repository {
	return &Repository{
		chats:    database.Collection(chatsCollection),
		messages: database.Collection(messagesCollection),
	}
}

// stamp truncates a timestamp to the precision bson stores datetimes at, so a
// timestamp the repository hands back matches the one it wrote.
func stamp(value time.Time) time.Time {
	return value.UTC().Truncate(time.Millisecond)
}

// wrap classifies a driver fault: an unreachable source is the service's own
// sentinel, so the transport layer can map it without the driver.
func wrap(op string, err error) error {
	if driver.IsNetworkError(err) || driver.IsTimeout(err) {
		return fmt.Errorf("repository: %s: %w: %w", op, services.ErrUnavailable, err)
	}
	return fmt.Errorf("repository: %s: %w", op, err)
}
