package cache

import "context"

type Connection interface {
	Ping(ctx context.Context) error
	Disconnect(ctx context.Context) error
}
