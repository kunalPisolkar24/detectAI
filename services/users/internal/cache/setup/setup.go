package setup

import (
	"context"
	"log/slog"

	"github.com/kunalPisolkar24/detectAI/services/users/internal/cache/client"
	"github.com/kunalPisolkar24/detectAI/services/users/internal/cache/limiter"
	"github.com/kunalPisolkar24/detectAI/services/users/internal/cache/lock"
	"github.com/kunalPisolkar24/detectAI/services/users/internal/cache/store"
)

type Plane struct {
	Store   store.Store
	Locker  lock.Locker
	Limiter limiter.Limiter
}

func New(ctx context.Context, endpoint string) (Plane, func(context.Context) error) {
	conn, err := client.Connect(ctx, endpoint)
	if err != nil {
		slog.Warn("redis unavailable; running without cache", "error", err)
		return Plane{
			Store:   store.Null{},
			Locker:  lock.Null{},
			Limiter: limiter.Null{},
		}, func(context.Context) error { return nil }
	}
	return Plane{
		Store:   store.NewRedis(conn),
		Locker:  lock.NewRedis(conn),
		Limiter: limiter.NewRedis(conn),
	}, conn.Disconnect
}
