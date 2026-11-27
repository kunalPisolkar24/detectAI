package limiter

import (
	"context"
)

type Null struct{}

var _ Limiter = Null{}

func (Null) Consume(_ context.Context, _ string, _ string, limit int) (Decision, error) {
	return Decision{Allowed: true, Limit: limit, Remaining: limit}, nil
}
