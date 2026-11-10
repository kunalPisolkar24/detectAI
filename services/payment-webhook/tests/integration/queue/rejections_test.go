package queue_test

import (
	"net/http"
	"testing"
	"time"
)

// The matrix runs over one live container whose queue stays sealed: a signed
// valid answer is never allowed to sneak past a guard, and every guard speaks
// the one verdict its contract names.
func TestRejectionsNeverTouchTheQueue(t *testing.T) {
	stack := newStack(t)
	goodBody := paddleBody("evt_matrix", "system.notification.tested", occurredAt, `{"note":"healthy"}`)
	foreignSecret := "wrong-plane-secret-16"

	rows := []struct {
		name      string
		body      []byte
		signature string
		want      int
		wantBody  string
	}{
		{"missing-signature", goodBody, "", http.StatusUnauthorized, `{"error":"unauthorized"}`},
		{"stale-signature", goodBody, signWith(webhookSecret, goodBody, 301), http.StatusUnauthorized, `{"error":"unauthorized"}`},
		{"wrong-secret", goodBody, signWith(foreignSecret, goodBody, 0), http.StatusUnauthorized, `{"error":"unauthorized"}`},
		{"malformed-signature", goodBody, "ts=oops;h1=zz", http.StatusUnauthorized, `{"error":"unauthorized"}`},
		// The read bound precedes auth: an oversized body answers 413 unsigned too.
		{"oversize-unsigned", bodyOfLength(t, "evt_matrix_oversize", 284<<10), "", http.StatusRequestEntityTooLarge,
			`{"error":"request body exceeds 262144 bytes"}`},
		{"oversize-signed", bodyOfLength(t, "evt_matrix_signed", 264<<10), signWith(webhookSecret, bodyOfLength(t, "evt_matrix_signed", 264<<10), 0), http.StatusRequestEntityTooLarge,
			`{"error":"request body exceeds 262144 bytes"}`},
		{"missing-event-id", paddleBody("", "system.notification.tested", occurredAt, `{"note":"anonymous"}`),
			signBody(paddleBody("", "system.notification.tested", occurredAt, `{"note":"anonymous"}`)),
			http.StatusUnprocessableEntity, `{"error":"payload rejected by the envelope check","missing":["event_id"]}`},
		{"null-data", paddleBody("evt_matrix_null", "system.notification.tested", occurredAt, `null`),
			signBody(paddleBody("evt_matrix_null", "system.notification.tested", occurredAt, `null`)),
			http.StatusUnprocessableEntity, `{"error":"payload rejected by the envelope check","missing":["data"]}`},
		{"bad-occurred-at", paddleBody("evt_matrix_tick", "system.notification.tested", "yesterday", `{"note":"now"}`),
			signBody(paddleBody("evt_matrix_tick", "system.notification.tested", "yesterday", `{"note":"now"}`)),
			http.StatusUnprocessableEntity, `{"error":"payload rejected by the envelope check","missing":["occurred_at"]}`},
		{"unparseable", []byte("not json at all"), signBody([]byte("not json at all")),
			http.StatusUnprocessableEntity, `{"error":"payload rejected by the envelope check","missing":["payload"]}`},
	}

	for _, row := range rows {
		t.Run(row.name, func(t *testing.T) {
			res, payload := stack.post(t, row.body, row.signature)
			requireStatus(t, res, payload, row.want)
			if row.wantBody != "" && payload != row.wantBody {
				t.Errorf("body = %q, want %q", payload, row.wantBody)
			}
		})
	}

	stack.pollSilence(t, 3*time.Second)
}

// A queue the app cannot reach is the outage row: the transport failure earns
// the same 503 + Retry-After verdict as throttling, Paddle's retry cue.
func TestQueueOutageAnswersUnavailable(t *testing.T) {
	stack := newStack(t)
	stack.stopQueue(t)
	body := paddleBody("evt_outage", "system.notification.tested", occurredAt, `{"note":"retry me"}`)

	res, payload := stack.post(t, body, signBody(body))
	requireStatus(t, res, payload, http.StatusServiceUnavailable)
	if got := res.Header.Get("Retry-After"); got != "5" {
		t.Errorf("Retry-After = %q, want the publish budget's ceiling", got)
	}
	if payload != `{"error":"queue unavailable","retryable":true}` {
		t.Errorf("body = %q, want the unavailable envelope", payload)
	}
}
