package cache

import (
	"context"
	"time"
)

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
