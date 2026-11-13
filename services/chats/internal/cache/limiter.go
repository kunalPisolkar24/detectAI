package cache

import (
	"context"
	"fmt"
	"time"

	driver "github.com/redis/go-redis/v9"
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

// Limiter counts a caller's calls inside a fixed window and reports whether
// the call fits the budget.
//
// A fault in the cache plane fails open: the caller absorbs the error and
// lets the call through.
type Limiter interface {
	// Consume counts one call for the owner in the scope's window and
	// reports the decision.
	Consume(ctx context.Context, ownerID, scope string, limit int) (Decision, error)
}

// Decision is the outcome of one counted call.
type Decision struct {
	// Allowed reports whether the call fits the limit.
	Allowed bool
	// Count is the calls counted in the window, this one included.
	Count int
	// Limit is the budget the call was measured against.
	Limit int
	// RetryAfter is the time left in the window.
	RetryAfter time.Duration
}

// limiter is the redis-backed burst counter.
type limiter struct {
	client *driver.Client
}

var _ Limiter = (*limiter)(nil)

// NewLimiter builds the counter over a connected client.
func NewLimiter(client *Client) Limiter {
	return &limiter{client: client.client}
}

// Consume counts one call in the owner's scope window.
func (l *limiter) Consume(ctx context.Context, ownerID, scope string, limit int) (Decision, error) {
	ctx, cancel := context.WithTimeout(ctx, limiterTimeout)
	defer cancel()

	now := time.Now().UTC()
	windowStart := now.Truncate(RateLimitWindow)
	windowEnd := windowStart.Add(RateLimitWindow)
	key := RateLimitKey(ownerID, scope, windowStart.Unix()/int64(RateLimitWindow/time.Second))

	count, err := l.increment(ctx, key, windowEnd.Add(RateLimitGrace))
	if err != nil {
		return Decision{}, err
	}
	return Decision{
		Allowed:    count <= limit,
		Count:      count,
		Limit:      limit,
		RetryAfter: windowEnd.Sub(now),
	}, nil
}

// increment counts one call and expires the counter after the window.
func (l *limiter) increment(ctx context.Context, key string, expiresAt time.Time) (int, error) {
	count, err := l.client.Eval(ctx, incrementScript, []string{key}, 1, expiresAt.Unix()).Int64()
	if err != nil {
		return 0, fmt.Errorf("redis: rate limit increment %s: %w", key, err)
	}
	return int(count), nil
}
