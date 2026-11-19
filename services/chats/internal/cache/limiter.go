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

// limiterTimeout bounds the counter call. The check fails open, so the cost of
// a cache fault is the wait: it must be a fraction of the socket timeout
// rather than the seconds a stalled redis would otherwise hold a write.
const limiterTimeout = 250 * time.Millisecond

// Limiter counts a caller's calls inside a fixed window and reports whether
// the call fits the budget. A fault in the cache plane fails open.
type Limiter interface {
	Consume(ctx context.Context, ownerID, scope string, limit int) (Decision, error)
}

type Decision struct {
	Allowed    bool
	Count      int
	Limit      int
	RetryAfter time.Duration
}

type limiter struct {
	client *driver.Client
}

var _ Limiter = (*limiter)(nil)

func NewLimiter(client *Client) Limiter {
	return &limiter{client: client.client}
}

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

func (l *limiter) increment(ctx context.Context, key string, expiresAt time.Time) (int, error) {
	count, err := l.client.Eval(ctx, incrementScript, []string{key}, 1, expiresAt.Unix()).Int64()
	if err != nil {
		return 0, fmt.Errorf("redis: rate limit increment %s: %w", key, err)
	}
	return int(count), nil
}
