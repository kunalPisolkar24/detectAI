package setup

import (
	"context"
	"log/slog"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/cache/client"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/cache/entries"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/cache/limiter"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/cache/store"
)

type Plane struct {
	Entries entries.Cache
	Limiter limiter.Limiter
}

// New establishes the cache plane, or degrades to no-op entries and a limiter
// that always allows when redis is unreachable so the source serves every call.
func New(ctx context.Context, endpoint string) (Plane, func(context.Context) error) {
	conn, err := client.Connect(ctx, endpoint)
	if err != nil {
		slog.Warn("redis unavailable; running without cache", "error", err)
		return Plane{
			Entries: entries.Null{},
			Limiter: limiter.Null{},
		}, func(context.Context) error { return nil }
	}
	return Plane{
		Entries: entries.New(store.NewRedis(conn)),
		Limiter: limiter.NewRedis(conn),
	}, conn.Disconnect
}
