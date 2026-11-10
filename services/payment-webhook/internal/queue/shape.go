package queue

import (
	"crypto/sha256"
	"encoding/hex"

	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/events"
)

const (
	SourcePaddle = "paddle"

	DefaultGroupID = "default"
)

// Shape builds the outbound message; a body without event_id dedups on its
// SHA-256 so identical bodies collide deterministically.
func Shape(body []byte) Message {
	event := events.ParseEvent(body)
	dedup := event.ID
	if dedup == "" {
		sum := sha256.Sum256(body)
		dedup = hex.EncodeToString(sum[:])
	}
	return Message{
		Body:           body,
		Source:         SourcePaddle,
		EventID:        event.ID,
		EventType:      event.Type,
		OccurredAt:     event.OccurredAt,
		SubscriptionID: event.Sub,
		TransactionID:  event.TransactionID,
		CustomerID:     event.Customer,
		UserID:         event.UserID,
		DedupID:        dedup,
		GroupID:        GroupKey(event),
	}
}

// GroupKey walks the ladder: subscription, customer, event type, else default.
// Groups are per-entity ordering domains; the worker orders cross-entity via occurred_at.
func GroupKey(event events.Event) string {
	if event.Sub != "" {
		return "subscription:" + event.Sub
	}
	if event.Customer != "" {
		return "customer:" + event.Customer
	}
	if event.Type != "" && event.Type != events.UnknownEventType {
		return event.Type
	}
	return DefaultGroupID
}
