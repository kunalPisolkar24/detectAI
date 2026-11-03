// Package queue carries ingress events to the payment events FIFO queue: one
// transport contract, the composition the Paddle face mounts, and the SQS
// binding. The body always rides verbatim; the SQS SDK is the durability point
// (FR-4, messaging.md).
package queue

import (
	"context"
	"errors"
)

// The publish outcomes (design.md error taxonomy): transport maps both to
// 503 with Retry-After — the retryable rows.
var (
	ErrEnqueueUnavailable = errors.New("queue: enqueue unavailable")
	ErrDeadlineExceeded   = errors.New("queue: publish budget exceeded")
)

// Message is the contract between shaping and transport. No SDK type crosses
// the Queue boundary — only this struct.
type Message struct {
	Body           []byte // forwarded byte-for-byte, never mutated (FR-4)
	Source         string // always "paddle"
	EventID        string // the parsed event_id, "" when absent (attribute omitted)
	EventType      string // "unknown" when absent
	OccurredAt     string // the raw RFC3339 occurred_at, verbatim from the body
	SubscriptionID string // data.subscription_id, or sub_-prefixed data.id ("" omits)
	TransactionID  string // data.transaction_id, or txn_-prefixed data.id ("" omits)
	CustomerID     string // data.customer_id, or ctm_-prefixed data.id ("" omits)
	UserID         string // data.custom_data.user_id, "" when absent (attribute omitted)
	DedupID        string // event_id when present, else sha256 of the body
	GroupID        string // the group-key ladder result
}

// Queue is the one-way transport contract. The Service composes it; the SQS
// adapter implements it; handler tests fake it.
type Queue interface {
	Publish(ctx context.Context, message Message) error
}
