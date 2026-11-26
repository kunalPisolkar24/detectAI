package limiter

import (
	"context"
	"fmt"
	"time"

	driver "github.com/redis/go-redis/v9"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/cache/client"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/cache/keys"
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

type Redis struct {
	client *driver.Client
}

var _ Limiter = (*Redis)(nil)

func NewRedis(client *client.Client) *Redis {
	return &Redis{client: client.Raw()}
}

func (l *Redis) Consume(ctx context.Context, ownerID, scope string, limit int) (Decision, error) {
	ctx, cancel := context.WithTimeout(ctx, limiterTimeout)
	defer cancel()

	now := time.Now().UTC()
	windowStart := now.Truncate(keys.RateLimitWindow)
	windowEnd := windowStart.Add(keys.RateLimitWindow)
	key := keys.RateLimitKey(ownerID, scope, windowStart.Unix()/int64(keys.RateLimitWindow/time.Second))

	count, err := l.increment(ctx, key, windowEnd.Add(keys.RateLimitGrace))
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

func (l *Redis) increment(ctx context.Context, key string, expiresAt time.Time) (int, error) {
	count, err := l.client.Eval(ctx, incrementScript, []string{key}, 1, expiresAt.Unix()).Int64()
	if err != nil {
		return 0, fmt.Errorf("redis: rate limit increment %s: %w", key, err)
	}
	return int(count), nil
}
