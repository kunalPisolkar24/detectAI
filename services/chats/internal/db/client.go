package db

import (
	"context"
	"fmt"
	"time"

	driver "go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

const dialTimeout = 5 * time.Second

// Client is the mongo-backed database connection.
type Client struct {
	client   *driver.Client
	database *driver.Database
}

var _ Database = (*Client)(nil)

// Connect dials the URI and fails loud when the server is unreachable. The
// caller owns the context budget.
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
	return &Client{client: client, database: client.Database(database)}, nil
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
