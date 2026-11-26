package lock

import (
	"context"
	"errors"
	"time"
)

var ErrLockHeld = errors.New("cache: lock held")

type Locker interface {
	Acquire(ctx context.Context, key string, ttl time.Duration) (token string, err error)
	Release(ctx context.Context, key, token string) error
}

type Policy struct {
	TTL         time.Duration
	MaxAttempts int
	BaseDelay   time.Duration
	MaxDelay    time.Duration
}

func NewPolicy(ttl time.Duration) Policy {
	return Policy{
		TTL:         ttl,
		MaxAttempts: 10,
		BaseDelay:   20 * time.Millisecond,
		MaxDelay:    250 * time.Millisecond,
	}
}
