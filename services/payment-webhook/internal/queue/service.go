package queue

import (
	"context"
	"errors"
	"time"
)

// Service composes the publish path: shape the raw body, run it through the
// transport under the publish budget (NFR-3), and hand back the typed outcome.
// Both faces mount it at boot; the body is never mutated (FR-4).
type Service struct {
	queue  Queue
	budget time.Duration
}

// NewService binds the transport and the budget. The budget owns Retry-After:
// the handler reads it back via Budget() to shape the 503.
func NewService(queue Queue, budget time.Duration) *Service {
	return &Service{queue: queue, budget: budget}
}

// Budget answers the configured publish budget.
func (s *Service) Budget() time.Duration { return s.budget }

// Publish shapes and delivers one event under the publish budget (NFR-3). A
// budget cost mid-enqueue — or the caller's context dying inside the call —
// answers ErrDeadlineExceeded even when the transport already returned; the
// dedup id makes the ambiguity harmless. Transport errors pass through their
// own vocabulary for the handler to map per the taxonomy.
func (s *Service) Publish(ctx context.Context, body []byte, source string) error {
	message := Shape(body, source)
	budgetCtx, cancel := context.WithTimeout(ctx, s.budget)
	defer cancel()
	err := s.queue.Publish(budgetCtx, message)
	if errors.Is(err, context.DeadlineExceeded) ||
		errors.Is(err, context.Canceled) ||
		budgetCtx.Err() != nil {
		return ErrDeadlineExceeded
	}
	return err
}
