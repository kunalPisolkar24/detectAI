package store

import (
	"context"
	"time"
)

type Store interface {
	Get(ctx context.Context, key string, into any) (found bool, err error)
	Set(ctx context.Context, key string, value any, ttl time.Duration) error
	Delete(ctx context.Context, keys ...string) error
}
