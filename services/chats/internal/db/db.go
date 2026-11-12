// Package db declares the database contract the service depends on.
package db

import "context"

// Database is the lifecycle surface of the backing store; the mongo adapter implements it.
type Database interface {
	Ping(ctx context.Context) error
	Disconnect(ctx context.Context) error
}
