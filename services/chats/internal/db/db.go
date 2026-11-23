package db

import "context"

type Database interface {
	Ping(ctx context.Context) error
	Disconnect(ctx context.Context) error
}
