// Package events parses Paddle ingress bodies into the event metadata the
// gateway contracts on. One home for Paddle's snake_case spellings: the
// envelope gate and the message shaping both consume ParseEvent, so they can
// never disagree about what an id is. The forwarded body is never altered by
// the parse (messaging.md).
package events

import (
	"encoding/json"
	"strings"
)

// UnknownEventType names the bucket for a blank event_type rather than an
// empty attribute value.
const UnknownEventType = "unknown"

// Event is the metadata the prerequisite parse may find in a payload. The
// subscription and customer ids feed the group ladder and double as message
// attributes; the rest are attribute-only reads.
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
