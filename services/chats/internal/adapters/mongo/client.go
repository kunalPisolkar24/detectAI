// Package mongo owns the database client lifecycle.
package mongo

import (
	"context"
	"fmt"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	driver "go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/db"
)

const (
	dialTimeout = 5 * time.Second

	chatsCollection    = "chats"
	messagesCollection = "messages"
)

// Client is the mongo-backed database connection.
type Client struct {
	client   *driver.Client
	database *driver.Database
}

var _ db.Database = (*Client)(nil)

// Connect dials the URI, fails loud when the server is unreachable, and
// ensures the data-model indexes. The caller owns the context budget.
func Connect(ctx context.Context, uri, database string) (*Client, error) {
	client, err := driver.Connect(options.Client().
		ApplyURI(uri).
		SetConnectTimeout(dialTimeout).
		SetServerSelectionTimeout(dialTimeout))
	if err != nil {
		return nil, fmt.Errorf("mongo: connect: %w", err)
	}
	if err := client.Ping(ctx, nil); err != nil {
		_ = client.Disconnect(ctx)
		return nil, fmt.Errorf("mongo: ping: %w", err)
	}
	d := client.Database(database)
	if err := ensureIndexes(ctx, d); err != nil {
		_ = client.Disconnect(ctx)
		return nil, fmt.Errorf("mongo: ensure indexes: %w", err)
	}
	return &Client{client: client, database: d}, nil
}

// Database exposes the connected handle the repository builds its collections on.
func (c *Client) Database() *driver.Database {
	return c.database
}

// Ping reports whether the server answers.
func (c *Client) Ping(ctx context.Context) error {
	return c.client.Ping(ctx, nil)
}

// Disconnect closes the connection.
func (c *Client) Disconnect(ctx context.Context) error {
	return c.client.Disconnect(ctx)
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
