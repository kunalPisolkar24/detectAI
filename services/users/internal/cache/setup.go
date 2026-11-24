package cache

import (
	"context"
	"log/slog"
)

// Setup establishes the cache plane, or degrades to a no-op connection when
// redis is unreachable so the source serves every call.
func Setup(ctx context.Context, endpoint string) (Connection, func(context.Context) error) {
	client, err := Connect(ctx, endpoint)
	if err != nil {
		slog.Warn("redis unavailable; running without cache", "error", err)
		return NullConnection{}, func(context.Context) error { return nil }
	}
	return client, client.Disconnect
}
