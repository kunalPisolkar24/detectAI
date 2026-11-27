package limiter

import (
	"context"
	"fmt"
	"time"

	"github.com/go-redis/redis_rate/v10"

	"github.com/kunalPisolkar24/detectAI/services/users/internal/cache/client"
	"github.com/kunalPisolkar24/detectAI/services/users/internal/cache/keys"
)

// limiterTimeout bounds the counter call. The check fails open, so the cost of
// a cache fault is the wait: it must be a fraction of the socket timeout
// rather than the seconds a stalled redis would otherwise hold a write.
const limiterTimeout = 250 * time.Millisecond

type Redis struct {
	rate *redis_rate.Limiter
}

var _ Limiter = (*Redis)(nil)

func NewRedis(client *client.Client) *Redis {
	return &Redis{rate: redis_rate.NewLimiter(client.Raw())}
}

func (l *Redis) Consume(ctx context.Context, identity, scope string, limit int) (Decision, error) {
	ctx, cancel := context.WithTimeout(ctx, limiterTimeout)
	defer cancel()

	result, err := l.rate.Allow(ctx, keys.RateLimitKey(identity, scope), redis_rate.PerMinute(limit))
	if err != nil {
		return Decision{}, fmt.Errorf("redis: rate limit check %s: %w", scope, err)
	}
	return Decision{
		Allowed:    result.Allowed > 0,
		Limit:      limit,
		Remaining:  result.Remaining,
		RetryAfter: positive(result.RetryAfter),
		ResetAfter: positive(result.ResetAfter),
	}, nil
}

func positive(value time.Duration) time.Duration {
	if value < 0 {
		return 0
	}
	return value
}
