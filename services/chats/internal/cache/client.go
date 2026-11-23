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
	opts, err := clientOptions(endpoint)
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
func clientOptions(endpoint string) (*driver.Options, error) {
	opts, err := driver.ParseURL(endpoint)
	if err != nil {
		return nil, fmt.Errorf("redis: parse endpoint: %w", err)
	}
	opts.DialTimeout = dialTimeout
	opts.ContextTimeoutEnabled = true
	return opts, nil
}

func (c *Client) Ping(ctx context.Context) error {
	return c.client.Ping(ctx).Err()
}

func (c *Client) Disconnect(context.Context) error {
	return c.client.Close()
}
