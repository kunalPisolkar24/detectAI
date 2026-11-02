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
// forwarded bytes are never altered by it (messaging.md).
type Event struct {
	ID       string
	Type     string
	Sub      string
	Customer string
}

// payloadData is the event's data object with every alias the group ladder
// reads, in no particular importance until the walk order decides.
type payloadData struct {
	SubscriptionID       string `json:"subscription_id"`
	SubscriptionIDCamel  string `json:"subscriptionId"`
	PaddleSubscriptionID string `json:"paddleSubscriptionId"`
	ID                   string `json:"id"`
	CustomerID           string `json:"customer_id"`
	CustomerIDCamel      string `json:"customerId"`
	UserID               string `json:"userId"`
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
		Body:      body,
		Source:    SourcePaddle,
		EventID:   event.ID,
		DedupID:   dedup,
		EventType: event.Type,
		GroupID:   GroupKey(event),
	}
}

// ParseEvent extracts the ladder inputs in one pass. A malformed or foreign
// shape answers a zero Event — Type fills as unknown downstream — and the
// caller queues it anyway (FR-7: the gateway is transport, not vocabulary).
func ParseEvent(body []byte) Event {
	var payload struct {
		EventID   string      `json:"event_id"`
		EventType string      `json:"event_type"`
		Data      payloadData `json:"data"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return Event{Type: UnknownEventType}
	}
	return Event{
		ID:       payload.EventID,
		Type:     eventType(payload.EventType),
		Sub:      subscriptionID(payload.Data),
		Customer: customerID(payload.Data),
	}
}

// eventType keeps the unknown bucket nameable rather than blank: a blank
// event_type parses as the unknown constant, never as a runnable rung.
func eventType(raw string) string {
	if strings.TrimSpace(raw) == "" {
		return UnknownEventType
	}
	return raw
}

// subscriptionID walks the aliases in order and accepts only sub_-prefixed
// data.id values — Paddle Billing embeds subscription-id events as the
// object's own id, so a bare id must not group everything carrying one.
func subscriptionID(data payloadData) string {
	for _, candidate := range []string{
		data.SubscriptionID, data.SubscriptionIDCamel, data.PaddleSubscriptionID,
	} {
		if candidate != "" {
			return candidate
		}
	}
	if strings.HasPrefix(data.ID, "sub_") {
		return data.ID
	}
	return ""
}

func customerID(data payloadData) string {
	for _, candidate := range []string{data.CustomerID, data.CustomerIDCamel, data.UserID} {
		if candidate != "" {
			return candidate
		}
	}
	return ""
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
