package queue

import (
	"context"
	"errors"
	"time"
)

// Service shapes the body and publishes it under the publish budget.
type Service struct {
	queue  Queue
	budget time.Duration
}

// NewService binds the transport and the budget the handler surfaces as Retry-After.
func NewService(queue Queue, budget time.Duration) *Service {
	return &Service{queue: queue, budget: budget}
}

func (s *Service) Budget() time.Duration { return s.budget }

// Publish maps budget expiry or caller cancellation to ErrDeadlineExceeded;
// the dedup id makes the did-it-enqueue ambiguity harmless.
func (s *Service) Publish(ctx context.Context, body []byte) error {
	message := Shape(body)
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
