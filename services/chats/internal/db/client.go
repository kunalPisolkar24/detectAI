package db

import (
	"context"
	"fmt"
	"time"

	driver "go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

const dialTimeout = 5 * time.Second

type Client struct {
	client   *driver.Client
	database *driver.Database
}

var _ Database = (*Client)(nil)

// Connect dials the URI and fails loud when the server is unreachable. The caller owns the context budget.
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

func (c *Client) Database() *driver.Database {
	return c.database
}

func (c *Client) Ping(ctx context.Context) error {
	return c.client.Ping(ctx, nil)
}

func (c *Client) Disconnect(ctx context.Context) error {
	return c.client.Disconnect(ctx)
}
