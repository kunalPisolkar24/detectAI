// Package repository implements the store.Repository contract against MongoDB.
package repository

import (
	"time"

	driver "go.mongodb.org/mongo-driver/v2/mongo"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/store"
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

var _ store.Repository = (*Repository)(nil)

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
