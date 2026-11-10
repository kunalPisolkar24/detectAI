// Package queue shapes and delivers events to the payment-events FIFO queue.
package queue

import (
	"context"
	"errors"
)

// Retryable publish outcomes; both map to a 503 with Retry-After.
var (
	ErrEnqueueUnavailable = errors.New("queue: enqueue unavailable")
	ErrDeadlineExceeded   = errors.New("queue: publish budget exceeded")
)

// Message is the contract between shaping and transport; no SDK type crosses it.
type Message struct {
	Body           []byte // forwarded verbatim from the request
	Source         string
	EventID        string
	EventType      string // "unknown" when the body names none
	OccurredAt     string
	SubscriptionID string // subscription_id, else the sub_-prefixed data.id
	TransactionID  string
	CustomerID     string
	UserID         string
	DedupID        string // event_id when present, else the sha256 of the body
	GroupID        string
}

type Queue interface {
	Publish(ctx context.Context, message Message) error
}
