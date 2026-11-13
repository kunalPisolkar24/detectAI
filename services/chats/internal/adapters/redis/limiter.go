package redis

import (
	"context"
	"fmt"
	"time"

	driver "github.com/redis/go-redis/v9"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/cache"
)

// incrementScript counts a call and pins the counter's expiry to the window
// edge; a non-atomic INCR-then-EXPIRE can leave an immortal key behind.
const incrementScript = `
local current = redis.call('INCRBY', KEYS[1], ARGV[1])
redis.call('EXPIREAT', KEYS[1], ARGV[2])
return current
`

// limiterTimeout bounds the counter call. The check fails open, so the cost
// of a cache fault is the wait: it must be a fraction of the socket timeout
// rather than the seconds a stalled redis would otherwise hold a write.
const limiterTimeout = 250 * time.Millisecond

// Limiter is the redis-backed burst counter.
type Limiter struct {
	client *driver.Client
}

var _ cache.Limiter = (*Limiter)(nil)

// NewLimiter builds the counter over a connected client.
func NewLimiter(client *Client) *Limiter {
	return &Limiter{client: client.client}
}

// Consume counts one call in the owner's scope window.
func (l *Limiter) Consume(ctx context.Context, ownerID, scope string, limit int) (cache.Decision, error) {
	ctx, cancel := context.WithTimeout(ctx, limiterTimeout)
	defer cancel()

	now := time.Now().UTC()
	windowStart := now.Truncate(cache.RateLimitWindow)
	windowEnd := windowStart.Add(cache.RateLimitWindow)
	key := cache.RateLimitKey(ownerID, scope, windowStart.Unix()/int64(cache.RateLimitWindow/time.Second))

	count, err := l.increment(ctx, key, windowEnd.Add(cache.RateLimitGrace))
	if err != nil {
		return cache.Decision{}, err
	}
	return cache.Decision{
		Allowed:    count <= limit,
		Count:      count,
		Limit:      limit,
		RetryAfter: windowEnd.Sub(now),
	}, nil
}

// increment counts one call and expires the counter after the window.
func (l *Limiter) increment(ctx context.Context, key string, expiresAt time.Time) (int, error) {
	count, err := l.client.Eval(ctx, incrementScript, []string{key}, 1, expiresAt.Unix()).Int64()
	if err != nil {
		return 0, fmt.Errorf("redis: rate limit increment %s: %w", key, err)
	}
	return int(count), nil
}
