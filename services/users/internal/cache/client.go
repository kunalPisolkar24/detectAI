package cache

import (
	"context"
	"fmt"
	"time"

	driver "github.com/redis/go-redis/v9"
)

const dialTimeout = 5 * time.Second

type Client struct {
	client *driver.Client
}

func Connect(ctx context.Context, endpoint string) (*Client, error) {
	opts, err := driver.ParseURL(endpoint)
	if err != nil {
		return nil, fmt.Errorf("redis: parse endpoint: %w", err)
	}
	opts.DialTimeout = dialTimeout
	// Without this go-redis ignores the caller's deadline and waits out the
	// socket timeout instead.
	opts.ContextTimeoutEnabled = true

	client := driver.NewClient(opts)
	if err := client.Ping(ctx).Err(); err != nil {
		_ = client.Close()
		return nil, fmt.Errorf("redis: ping: %w", err)
	}
	return &Client{client: client}, nil
}

func (c *Client) Ping(ctx context.Context) error {
	return c.client.Ping(ctx).Err()
}

func (c *Client) Disconnect(ctx context.Context) error {
	return c.client.Close()
}
