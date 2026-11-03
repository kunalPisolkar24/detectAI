package queue

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"strings"
)

const (
	SourcePaddle = "paddle"

	UnknownEventType = "unknown"
	DefaultGroupID   = "default"
)

// Event is the metadata the prerequisite parse may find in a payload. The
// forwarded bytes are never altered by it (messaging.md): the subscription and
// customer ids feed the group ladder and double as attributes, the rest are
// attribute-only reads.
type Event struct {
	ID            string
	Type          string
	Sub           string
	Customer      string
	TransactionID string
	OccurredAt    string
	UserID        string
}

// payloadData is the event's data object: Paddle's snake_case spellings plus
// the object's own id, which the prefix guards qualify per entity kind.
type payloadData struct {
	ID             string         `json:"id"`
	SubscriptionID string         `json:"subscription_id"`
	TransactionID  string         `json:"transaction_id"`
	CustomerID     string         `json:"customer_id"`
	CustomData     map[string]any `json:"custom_data"`
}

// Shape parses the payload for metadata only and computes the dedup id: the
// parsed event_id when present, else the SHA-256 of the body — content-based
// determinism the queue-level flag cannot add once events lack their id. The
// gateway is Paddle-only: Source is the constant, never a parameter.
func Shape(body []byte) Message {
	event := ParseEvent(body)
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

// ParseEvent extracts the ladder inputs and attribute sources in one pass. A
// malformed or foreign shape answers a zero Event — Type fills as unknown
// downstream — and the caller queues it anyway (FR-7: the gateway is
// transport, not vocabulary).
func ParseEvent(body []byte) Event {
	var payload struct {
		EventID    string      `json:"event_id"`
		EventType  string      `json:"event_type"`
		OccurredAt string      `json:"occurred_at"`
		Data       payloadData `json:"data"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return Event{Type: UnknownEventType}
	}
	data := payload.Data
	return Event{
		ID:            payload.EventID,
		Type:          eventType(payload.EventType),
		Sub:           subscriptionID(data),
		Customer:      customerID(data),
		TransactionID: transactionID(data),
		OccurredAt:    payload.OccurredAt,
		UserID:        userID(data),
	}
}

// eventType keeps the unknown bucket nameable rather than blank.
func eventType(raw string) string {
	if strings.TrimSpace(raw) == "" {
		return UnknownEventType
	}
	return raw
}

// subscriptionID and customerID share one shape: the explicit field first,
// then the object's own id when it carries the entity's Paddle id prefix —
// Paddle Billing embeds entity ids as data.id, and a bare id must not group
// under the wrong rung.
func subscriptionID(data payloadData) string {
	if data.SubscriptionID != "" {
		return data.SubscriptionID
	}
	if strings.HasPrefix(data.ID, "sub_") {
		return data.ID
	}
	return ""
}

func customerID(data payloadData) string {
	if data.CustomerID != "" {
		return data.CustomerID
	}
	if strings.HasPrefix(data.ID, "ctm_") {
		return data.ID
	}
	return ""
}

// transactionID reads the first-billing link subscription.created carries,
// then the object's own id under the txn_ guard.
func transactionID(data payloadData) string {
	if data.TransactionID != "" {
		return data.TransactionID
	}
	if strings.HasPrefix(data.ID, "txn_") {
		return data.ID
	}
	return ""
}

// userID reads the checkout's propagated custom_data, snake_case throughout.
func userID(data payloadData) string {
	text, ok := data.CustomData["user_id"].(string)
	if !ok {
		return ""
	}
	return text
}

// GroupKey is the group-key ladder verbatim (messaging.md): subscription →
// customer → event_type → default. A known-but-novel event_type still groups
// per type; only a shape with nothing usable lands on default.
func GroupKey(event Event) string {
	if event.Sub != "" {
		return "subscription:" + event.Sub
	}
	if event.Customer != "" {
		return "customer:" + event.Customer
	}
	if event.Type != "" && event.Type != UnknownEventType {
		return event.Type
	}
	return DefaultGroupID
}
