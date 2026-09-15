package domain

import "encoding/json"

const UnknownEventType = "unknown"

type Event struct {
	ID   string
	Type string
	Raw  []byte
}

func ParseEvent(body []byte) Event {
	var payload struct {
		EventID   string `json:"event_id"`
		EventType string `json:"event_type"`
		AlertName string `json:"alert_name"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return Event{Type: UnknownEventType, Raw: body}
	}
	typ := payload.EventType
	if typ == "" {
		typ = payload.AlertName
	}
	if typ == "" {
		typ = UnknownEventType
	}
	return Event{ID: payload.EventID, Type: typ, Raw: body}
}
