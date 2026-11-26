package cache

import (
	"context"
	"errors"
	"log/slog"
	"math/rand/v2"
	"time"
)

const releaseTimeout = time.Second

func Execute[T any](
	ctx context.Context,
	locker Locker,
	key string,
	policy Policy,
	fn func(context.Context) (T, error),
) (T, error) {
	var zero T
	if err := ctx.Err(); err != nil {
		return zero, err
	}

	token, err := locker.Acquire(ctx, key, policy.TTL)
	if err == nil {
		return runLocked(ctx, locker, key, token, fn)
	}
	if !errors.Is(err, ErrLockHeld) {
		slog.Warn("cache: lock unavailable; running without lock", "key", key, "error", err)
		return fn(ctx)
	}

	delay := policy.BaseDelay
	for attempt := 1; attempt < policy.MaxAttempts; attempt++ {
		select {
		case <-ctx.Done():
			return zero, ctx.Err()
		case <-time.After(jitter(delay, policy.MaxDelay)):
		}

		token, err := locker.Acquire(ctx, key, policy.TTL)
		if err == nil {
			return runLocked(ctx, locker, key, token, fn)
		}
		if !errors.Is(err, ErrLockHeld) {
			slog.Warn("cache: lock unavailable; running without lock", "key", key, "error", err)
			return fn(ctx)
		}
		delay = min(delay*2, policy.MaxDelay)
	}

	slog.Warn("cache: lock contended; running without lock", "key", key, "attempts", policy.MaxAttempts)
	return fn(ctx)
}

func runLocked[T any](
	ctx context.Context,
	locker Locker,
	key, token string,
	fn func(context.Context) (T, error),
) (T, error) {
	defer func() {
		releaseCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), releaseTimeout)
		defer cancel()
		if err := locker.Release(releaseCtx, key, token); err != nil {
			slog.Warn("cache: lock release failed", "key", key, "error", err)
		}
	}()
	return fn(ctx)
}

func jitter(delay, limit time.Duration) time.Duration {
	if limit <= 0 {
		limit = delay
	}
	if delay <= 0 {
		return 0
	}
	bound := min(delay, limit)
	return time.Duration(rand.Int64N(int64(bound)))
}
