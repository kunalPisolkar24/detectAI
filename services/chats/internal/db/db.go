// Package db owns the database connection: the lifecycle contract the service
// depends on and the mongo-backed client that implements it.
package db

import "context"

// Database is the lifecycle surface of the backing store; the mongo client
// implements it.
type Database interface {
	Ping(ctx context.Context) error
	Disconnect(ctx context.Context) error
}
