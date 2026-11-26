package cache

import (
	"context"
	"log/slog"
)

type Plane struct {
	Store  Store
	Locker Locker
}

func Setup(ctx context.Context, endpoint string) (Plane, func(context.Context) error) {
	client, err := Connect(ctx, endpoint)
	if err != nil {
		slog.Warn("redis unavailable; running without cache", "error", err)
		return Plane{Store: NullStore{}, Locker: NullLocker{}}, func(context.Context) error { return nil }
	}
	return Plane{Store: NewStore(client), Locker: NewLocker(client)}, client.Disconnect
}
