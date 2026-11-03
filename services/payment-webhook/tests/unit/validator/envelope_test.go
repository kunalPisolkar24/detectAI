package validator_test

import (
	"encoding/json"
	"testing"

	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/validator"
)

// fullEnvelope is the real Paddle shape: four hard fields plus the delivery id,
// with a sub_-prefixed data.id.
var fullEnvelope = []byte(`{"event_id":"ntfsimevt_01m6dk7m1cmrykjg0da6qt2tke","event_type":"subscription.created","occurred_at":"2026-11-02T07:40:26.540606Z","notification_id":"ntfsimntf_01m6dk7m3h1gz9pfrhc9t33ty2","data":{"id":"sub_01hv8x29kz0t586xy6zn1a62ny"}}`)

func without(keys ...string) []byte {
	fields := envelopeFields()
	for _, key := range keys {
		delete(fields, key)
	}
	return marshal(fields)
}

// replaced swaps one top-level key for arbitrary raw JSON.
func replaced(key, raw string) []byte {
	fields := envelopeFields()
	fields[key] = json.RawMessage(raw)
	return marshal(fields)
}

func envelopeFields() map[string]json.RawMessage {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(fullEnvelope, &fields); err != nil {
		panic(err)
	}
	return fields
}

func marshal(fields map[string]json.RawMessage) []byte {
	out, err := json.Marshal(fields)
	if err != nil {
		panic(err)
	}
	return out
}

func TestCheckEnvelopePassesPaddleShapedBodies(t *testing.T) {
	cases := map[string][]byte{
		"the full envelope":            fullEnvelope,
		"unknown top-level key":        replaced("delivery_attempt", "2"),
		"novel event_type":             replaced("event_type", `"some.future.event"`),
		"second-precision occurred_at": replaced("occurred_at", `"2026-11-02T07:40:26Z"`),
	}
	for name, body := range cases {
		t.Run(name, func(t *testing.T) {
			checkIssues(t, validator.CheckEnvelope(body), nil, nil)
		})
	}
}

func TestCheckEnvelopeRejectsNonObjects(t *testing.T) {
	cases := map[string]string{
		"array":     `[{"event_id":"x"}]`,
		"string":    `"a webhook body"`,
		"number":    `42`,
		"null":      `null`,
		"empty":     ``,
		"garbage":   `not json at all`,
		"truncated": `{"event_id":`,
	}
	for name, body := range cases {
		t.Run(name, func(t *testing.T) {
			checkIssues(t, validator.CheckEnvelope([]byte(body)), []string{"payload"}, nil)
		})
	}
}

func TestCheckEnvelopeGatesEveryHardField(t *testing.T) {
	cases := map[string]struct {
		body       []byte
		wantReason string
	}{
		"absent event_id":         {without("event_id"), "event_id"},
		"blank event_id":          {replaced("event_id", `"   "`), "event_id"},
		"null event_id":           {replaced("event_id", `null`), "event_id"},
		"numeric event_id":        {replaced("event_id", `42`), "event_id"},
		"absent event_type":       {without("event_type"), "event_type"},
		"blank event_type":        {replaced("event_type", `""`), "event_type"},
		"numeric event_type":      {replaced("event_type", `9`), "event_type"},
		"absent occurred_at":      {without("occurred_at"), "occurred_at"},
		"unparseable occurred_at": {replaced("occurred_at", `"not a time"`), "occurred_at"},
		"numeric occurred_at":     {replaced("occurred_at", `1700000000`), "occurred_at"},
		"naive occurred_at":       {replaced("occurred_at", `"2026-11-02T07:40:26.540606"`), "occurred_at"},
		"absent data":             {without("data"), "data"},
		"null data":               {replaced("data", `null`), "data"},
		"array data":              {replaced("data", `[1]`), "data"},
		"string data":             {replaced("data", `"x"`), "data"},
		"numeric data":            {replaced("data", `7`), "data"},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			checkIssues(t, validator.CheckEnvelope(tc.body), []string{tc.wantReason}, nil)
		})
	}
}

func TestCheckEnvelopeSortsAndNamesEveryMiss(t *testing.T) {
	body := without("data", "occurred_at")
	checkIssues(t, validator.CheckEnvelope(body), []string{"data", "occurred_at"}, nil)
}

func TestCheckEnvelopeAdvisesWithoutRejecting(t *testing.T) {
	cases := map[string]struct {
		body     []byte
		advisory string
	}{
		"absent notification_id":    {without("notification_id"), "notification_id"},
		"null notification_id":      {replaced("notification_id", `null`), "notification_id"},
		"blank notification_id":     {replaced("notification_id", `"  "`), "notification_id"},
		"unaddressable data":        {replaced("data", `{"items":[]}`), "addressable_id"},
		"unaddressable no id field": {replaced("data", `{}`), "addressable_id"},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			checkIssues(t, validator.CheckEnvelope(tc.body), nil, []string{tc.advisory})
		})
	}
}

func TestCheckEnvelopeOnlyAdvisesOnAddressability(t *testing.T) {
	// A bare data.id resolves only under the sub_/ctm_ prefix; a prefix-free id
	// stays advisory-only.
	body := replaced("data", `{"id":"not_a_paddle_id"}`)
	checkIssues(t, validator.CheckEnvelope(body), nil, []string{"addressable_id"})
}

// checkIssues asserts both halves of the sorted verdict positionally.
func checkIssues(t *testing.T, issues *validator.EnvelopeIssues, wantMissing, wantAdvisory []string) {
	t.Helper()
	if issues == nil {
		t.Fatal("issues = nil, want a verdict")
	}
	if !same(issues.Missing, wantMissing) {
		t.Errorf("Missing = %v, want %v", issues.Missing, wantMissing)
	}
	if !same(issues.Advisory, wantAdvisory) {
		t.Errorf("Advisory = %v, want %v", issues.Advisory, wantAdvisory)
	}
}

func same(xs, ys []string) bool {
	if len(xs) != len(ys) {
		return false
	}
	for i := range xs {
		if xs[i] != ys[i] {
			return false
		}
	}
	return true
}
