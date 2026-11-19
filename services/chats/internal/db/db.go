// Package db owns the database connection: the lifecycle contract the service depends on and the mongo-backed client.
package db

import "context"

// The lifecycle surface of the backing store; the mongo client implements it.
type Database interface {
	Ping(ctx context.Context) error
	Disconnect(ctx context.Context) error
}
