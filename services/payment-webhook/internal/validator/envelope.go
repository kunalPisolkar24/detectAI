package validator

import (
	"encoding/json"
	"sort"
	"strings"
	"time"

	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/events"
)

// EnvelopeIssues is the one-pass verdict; Missing rejects and Advisory only counts.
type EnvelopeIssues struct {
	Missing  []string
	Advisory []string
}

// CheckEnvelope judges envelope presence only; values and data contents remain
// the worker's interpretation, and extra top-level keys are tolerated.
func CheckEnvelope(body []byte) *EnvelopeIssues {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(body, &fields); err != nil || fields == nil {
		// A body that never parses to an object has no envelope to judge.
		return &EnvelopeIssues{Missing: []string{"payload"}}
	}
	issues := &EnvelopeIssues{}
	for _, hard := range []string{"event_id", "event_type", "occurred_at", "data"} {
		if !satisfiesHardGate(fields, hard) {
			issues.Missing = append(issues.Missing, hard)
		}
	}
	sort.Strings(issues.Missing)
	if len(issues.Missing) > 0 {
		return issues
	}
	if requiredString(fields, "notification_id") == "" {
		// Delivery-layer only: dropping it is a counter, never a rejection.
		issues.Advisory = append(issues.Advisory, "notification_id")
	}
	// The advisory sees the same addressability the group ladder will see.
	if event := events.ParseEvent(body); event.Sub == "" && event.Customer == "" {
		issues.Advisory = append(issues.Advisory, "addressable_id")
	}
	sort.Strings(issues.Advisory)
	return issues
}

// satisfiesHardGate checks presence with substance; absent, blank, null, and
// mistyped values all fail the same gate.
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

// requiredString blank-fails absent, non-string, null, and whitespace-only values.
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
