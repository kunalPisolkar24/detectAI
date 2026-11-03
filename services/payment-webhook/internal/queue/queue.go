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
	Source         string // always "paddle"
	EventID        string // parsed event_id
	EventType      string // "unknown" when absent
	OccurredAt     string // raw occurred_at, verbatim from the body
	SubscriptionID string // subscription_id, or sub_-prefixed data.id
	TransactionID  string // transaction_id, or txn_-prefixed data.id
	CustomerID     string // customer_id, or ctm_-prefixed data.id
	UserID         string // custom_data.user_id
	DedupID        string // event_id when present, else the sha256 of the body
	GroupID        string // the group-ladder result
}

// Queue is the one-way publish contract.
type Queue interface {
	Publish(ctx context.Context, message Message) error
}
