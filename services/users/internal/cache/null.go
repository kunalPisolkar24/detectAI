package cache

import (
	"context"
	"time"
)

type NullStore struct{}

var (
	_ Store  = NullStore{}
	_ Locker = NullLocker{}
)

func (NullStore) Get(context.Context, string, any) (bool, error) {
	return false, nil
}

func (NullStore) Set(context.Context, string, any, time.Duration) error {
	return nil
}

func (NullStore) Delete(context.Context, ...string) error {
	return nil
}

type NullLocker struct{}

func (NullLocker) Acquire(context.Context, string, time.Duration) (string, error) {
	return "null", nil
}

func (NullLocker) Release(context.Context, string, string) error {
	return nil
}

type NullLimiter struct{}

var _ Limiter = NullLimiter{}

func (NullLimiter) Consume(_ context.Context, _ string, _ string, limit int) (Decision, error) {
	return Decision{Allowed: true, Limit: limit}, nil
}
