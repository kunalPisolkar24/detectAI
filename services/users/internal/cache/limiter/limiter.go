package limiter

import (
	"context"
	"time"
)

type Limiter interface {
	Consume(ctx context.Context, identity, scope string, limit int) (Decision, error)
}

type Decision struct {
	Allowed    bool
	Limit      int
	Remaining  int
	RetryAfter time.Duration
	ResetAfter time.Duration
}
