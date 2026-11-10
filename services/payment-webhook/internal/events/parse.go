// Package events parses Paddle bodies once so envelope and message shaping
// cannot disagree about ids.
package events

import (
	"encoding/json"
	"strings"
)

// UnknownEventType labels a blank event_type.
const UnknownEventType = "unknown"

// Event carries the message-shaping inputs parsed from a Paddle body.
type Event struct {
	ID            string
	Type          string
	Sub           string
	Customer      string
	TransactionID string
	OccurredAt    string
	UserID        string
}

type payloadData struct {
	ID             string         `json:"id"`
	SubscriptionID string         `json:"subscription_id"`
	TransactionID  string         `json:"transaction_id"`
	CustomerID     string         `json:"customer_id"`
	CustomData     map[string]any `json:"custom_data"`
}

// ParseEvent reads event metadata in one pass; a malformed body yields an unknown-typed Event.
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

func eventType(raw string) string {
	if strings.TrimSpace(raw) == "" {
		return UnknownEventType
	}
	return raw
}

// subscriptionID reads the explicit field first, then a sub_-prefixed data.id — a bare id must not group wrongly.
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

func transactionID(data payloadData) string {
	if data.TransactionID != "" {
		return data.TransactionID
	}
	if strings.HasPrefix(data.ID, "txn_") {
		return data.ID
	}
	return ""
}

func userID(data payloadData) string {
	text, ok := data.CustomData["user_id"].(string)
	if !ok {
		return ""
	}
	return text
}
