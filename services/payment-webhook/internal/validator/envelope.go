package validator

import (
	"encoding/json"
	"sort"
	"strings"
	"time"

	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/queue"
)

// EnvelopeIssues splits the one-pass verdict over a Paddle body. Missing drives
// the 422 at the transport; Advisory records drift-shaped oddities the worker
// never needs to reject on (the counters land with the observability build).
type EnvelopeIssues struct {
	Missing  []string // event_id, event_type, occurred_at, data, payload
	Advisory []string // notification_id, addressable_id
}

// CheckEnvelope verifies the Paddle envelope exists: the four core fields the
// worker and FIFO ordering depend on (http.md). It judges presence, type, and
// shape only — values, event_type vocabulary, and data contents stay the
// worker's (FR-7). Extra top-level keys are tolerated, per the open-set rule.
func CheckEnvelope(body []byte) *EnvelopeIssues {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(body, &fields); err != nil || fields == nil {
		// A body that never parses to an object carries no envelope to judge:
		// array/string/number/null cases name the payload as a whole.
		return &EnvelopeIssues{Missing: []string{"payload"}}
	}
	issues := &EnvelopeIssues{}
	for _, hard := range []string{"event_id", "event_type", "occurred_at", "data"} {
		if !satisfiesHardGate(fields, hard) {
			issues.Missing = append(issues.Missing, hard)
		}
	}
	sort.Strings(issues.Missing)
	// Advisory only matters for bodies that will queue: a rejected body opens
	// no advisory dimension worth counting, so the 422 path stops here.
	if len(issues.Missing) > 0 {
		return issues
	}
	if requiredString(fields, "notification_id") == "" {
		// Delivery-layer id with no downstream consumer: evolution or replay
		// wrappers that drop it are a counter, never a rejection.
		issues.Advisory = append(issues.Advisory, "notification_id")
	}
	// ParseEvent is the alias list's single home (messaging.md): the advisory
	// sees exactly the addressability the group ladder will see.
	if event := queue.ParseEvent(body); event.Sub == "" && event.Customer == "" {
		issues.Advisory = append(issues.Advisory, "addressable_id")
	}
	sort.Strings(issues.Advisory)
	return issues
}

// satisfiesHardGate answers whether the field is present with real substance:
// a JSON string that trims to something, an RFC3339-parseable timestamp, or —
// for data — a non-nil JSON object. Absent, blank, null, and mistyped values
// all fail the same gate under one reason.
func satisfiesHardGate(fields map[string]json.RawMessage, name string) bool {
	raw, ok := fields[name]
	if !ok {
		return false
	}
	switch name {
	case "data":
		var object map[string]any
		// json.Unmarshal("null") yields no error and a nil map — must fail.
		return json.Unmarshal(raw, &object) == nil && object != nil
	case "occurred_at":
		stamp := requiredString(fields, name)
		if stamp == "" {
			return false
		}
		_, err := time.Parse(time.RFC3339, stamp)
		return err == nil
	default:
		return requiredString(fields, name) != ""
	}
}

// requiredString reads one JSON string field: absent, non-string, null, or
// whitespace-only all blank-fail. Nothing here trims for the caller — the
// trimmed-shape question is the gate's, the value rides through untouched.
func requiredString(fields map[string]json.RawMessage, name string) string {
	raw, ok := fields[name]
	if !ok {
		return ""
	}
	var value string
	if json.Unmarshal(raw, &value) != nil || strings.TrimSpace(value) == "" {
		return ""
	}
	return value
}
