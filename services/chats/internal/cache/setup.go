package cache

import (
	"context"
	"log/slog"
)

// Setup establishes the cache plane, or degrades to a no-op cache and limiter
// when redis is unreachable so the source serves every call.
func Setup(ctx context.Context, endpoint string) (Cache, Limiter, func(context.Context) error) {
	client, err := Connect(ctx, endpoint)
	if err != nil {
		slog.Warn("redis unavailable; running without cache", "error", err)
		return NullCache{}, NullLimiter{}, func(context.Context) error { return nil }
	}
	return NewEntries(client), NewLimiter(client), client.Disconnect
}
