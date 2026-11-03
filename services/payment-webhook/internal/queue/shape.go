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

// Shape builds the outbound message from a raw Paddle body: the parsed event
// metadata resolves the identifiers, the dedup id is the parsed event_id when
// present else the SHA-256 of the body — content-based determinism the
// queue-level flag cannot add once events lack their id. The gateway is
// Paddle-only: Source is the constant, never a parameter.
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

// GroupKey is the group-key ladder verbatim (messaging.md): subscription →
// customer → event_type → default. A known-but-novel event_type still groups
// per type; only a shape with nothing usable lands on default.
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
