// Package cache declares the cache-plane contract the service depends on.
package cache

import "context"

// Cache is the lifecycle surface of the cache plane; the redis adapter implements it.
type Cache interface {
	Ping(ctx context.Context) error
	Disconnect(ctx context.Context) error
}
