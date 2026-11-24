package db

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

const dialTimeout = 5 * time.Second

type Client struct {
	pool *pgxpool.Pool
}

var _ Database = (*Client)(nil)

func Connect(ctx context.Context, dsn string) (*Client, error) {
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, fmt.Errorf("postgres: connect: %w", err)
	}
	cfg.ConnConfig.ConnectTimeout = dialTimeout

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("postgres: connect: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("postgres: ping: %w", err)
	}
	return &Client{pool: pool}, nil
}

// ConnectWithRetry dials until the server answers or the caller's budget runs
// out. It absorbs the race where the process starts before postgres is ready,
// and returns the last failure so a wrong DSN is still reported at boot.
func ConnectWithRetry(ctx context.Context, dsn string, interval time.Duration) (*Client, error) {
	for {
		client, err := Connect(ctx, dsn)
		if err == nil {
			return client, nil
		}
		if ctx.Err() != nil {
			return nil, err
		}
		select {
		case <-ctx.Done():
			return nil, err
		case <-time.After(interval):
		}
	}
}

func (c *Client) Pool() *pgxpool.Pool {
	return c.pool
}

func (c *Client) Ping(ctx context.Context) error {
	return c.pool.Ping(ctx)
}

// Disconnect bounds the pgx pool close with the caller's drain budget: pgx
// closes synchronously and waits for checked-out connections to return.
func (c *Client) Disconnect(ctx context.Context) error {
	done := make(chan struct{})
	go func() {
		c.pool.Close()
		close(done)
	}()
	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}
