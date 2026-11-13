// Package redis owns the cache-plane client lifecycle.
package redis

import (
	"context"
	"fmt"
	"time"

	driver "github.com/redis/go-redis/v9"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/cache"
)

const dialTimeout = 5 * time.Second

// Client is the redis-backed cache connection.
type Client struct {
	client *driver.Client
}

var _ cache.Cache = (*Client)(nil)

// Connect dials the endpoint, fails loud when the server is unreachable, and
// authenticates with the token when one is set. The caller owns the context budget.
func Connect(ctx context.Context, endpoint, authToken string) (*Client, error) {
	opts, err := clientOptions(endpoint, authToken)
	if err != nil {
		return nil, err
	}
	client := driver.NewClient(opts)
	if err := client.Ping(ctx).Err(); err != nil {
		_ = client.Close()
		return nil, fmt.Errorf("redis: ping: %w", err)
	}
	return &Client{client: client}, nil
}

// clientOptions builds the driver's options for an endpoint. The context
// timeout is enabled because the driver otherwise ignores the caller's
// deadline and waits out the socket timeout, holding a caller for seconds
// while the server stalls.
func clientOptions(endpoint, authToken string) (*driver.Options, error) {
	opts, err := driver.ParseURL(endpoint)
	if err != nil {
		return nil, fmt.Errorf("redis: parse endpoint: %w", err)
	}
	if authToken != "" {
		opts.Password = authToken
	}
	opts.DialTimeout = dialTimeout
	opts.ContextTimeoutEnabled = true
	return opts, nil
}

// Ping reports whether the server answers.
func (c *Client) Ping(ctx context.Context) error {
	return c.client.Ping(ctx).Err()
}

// Disconnect closes the connection.
func (c *Client) Disconnect(context.Context) error {
	return c.client.Close()
}
