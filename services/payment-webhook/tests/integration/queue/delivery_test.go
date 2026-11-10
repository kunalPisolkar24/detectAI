package queue_test

import (
	"crypto/md5"
	"encoding/hex"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/queue"
)

func TestProbesServeOnTheRealBoot(t *testing.T) {
	stack := newStack(t)
	for path, want := range map[string]string{
		"/api/v1/health": `{"status":"ok"}`,
		"/api/v1/ready":  `{"status":"ready"}`,
	} {
		res, body := stack.get(t, path)
		if res.StatusCode != http.StatusOK {
			t.Errorf("GET %s = %d, want 200", path, res.StatusCode)
		}
		if body != want {
			t.Errorf("GET %s body = %q, want %q", path, body, want)
		}
	}
}

func TestDeliveryCrossesTheQueueVerbatim(t *testing.T) {
	stack := newStack(t)
	// The note hides escapes, unicode, and whitespace: any re-encode breaks
	// the byte identity the worker builds its parsing on.
	body := paddleBody("evt_verbatim", "subscription.updated", occurredAt,
		`{"id":"sub_verbatim","note":"café 😀 \n \"quoted\" \\ \ttab"}`)
	res, payload := stack.post(t, body, signBody(body))
	requireStatus(t, res, payload, http.StatusOK)
	if payload != `{"status":"queued"}` {
		t.Errorf("ack = %q, want the queued envelope", payload)
	}

	messages := stack.collect(t, 1, 5*time.Second)
	if len(messages) != 1 {
		t.Fatalf("delivered = %d, want 1", len(messages))
	}
	if deref(messages[0].Body) != string(body) {
		t.Errorf("delivered body %q, want the webhook body byte-for-byte", deref(messages[0].Body))
	}
	sum := md5.Sum(body)
	if deref(messages[0].MD5OfBody) != hex.EncodeToString(sum[:]) {
		t.Errorf("MD5OfBody = %q, want the checksum of the webhook body", deref(messages[0].MD5OfBody))
	}
	if got := stack.system(t, messages[0], "MessageGroupId"); got != "subscription:sub_verbatim" {
		t.Errorf("MessageGroupId = %q, want the ladder group", got)
	}
}

func TestDeliveryRidesTheIDsOnMessageAttributes(t *testing.T) {
	stack := newStack(t)
	body := paddleBody("evt_attrs", "subscription.updated", occurredAt,
		`{"id":"sub_attached","subscription_id":"sub_explicit","transaction_id":"txn_explicit","customer_id":"ctm_explicit","custom_data":{"user_id":"usr_explicit"}}`)
	res, payload := stack.post(t, body, signBody(body))
	requireStatus(t, res, payload, http.StatusOK)

	messages := stack.collect(t, 1, 5*time.Second)
	if len(messages) != 1 {
		t.Fatalf("delivered = %d, want 1", len(messages))
	}
	for name, want := range map[string]string{
		"source":          queue.SourcePaddle,
		"event_type":      "subscription.updated",
		"event_id":        "evt_attrs",
		"occurred_at":     occurredAt,
		"subscription_id": "sub_explicit",
		"transaction_id":  "txn_explicit",
		"customer_id":     "ctm_explicit",
		"user_id":         "usr_explicit",
	} {
		if got := stack.attr(t, messages[0], name); got != want {
			t.Errorf("attribute %q = %q, want %q", name, got, want)
		}
	}
	if len(messages[0].MessageAttributes) != 8 {
		t.Errorf("attribute count = %d, want 8", len(messages[0].MessageAttributes))
	}
}

func TestTheGroupLadderLandsOnTheQueue(t *testing.T) {
	stack := newStack(t)
	rows := []struct {
		eventID string
		data    string
		group   string
	}{
		// subscription wins over every lower rung the body carries.
		{"evt_ladder_sub", `{"id":"sub_l1","customer_id":"ctm_hidden"}`, "subscription:sub_l1"},
		// a bare customer-shaped id names the customer rung.
		{"evt_ladder_ctm", `{"id":"ctm_l2"}`, "customer:ctm_l2"},
		// an unprefixable id the event_type rung the ladder's voice.
		{"evt_ladder_type", `{"note":"entity-free"}`, "system.notification.tested"},
		// the unknown sentinel passes the gate and falls to the default rung.
		{"evt_ladder_default", `{"note":"nobody"}`, queue.DefaultGroupID},
	}
	for index, row := range rows {
		eventType := "system.notification.tested"
		if index == len(rows)-1 {
			eventType = "unknown"
		}
		body := paddleBody(row.eventID, eventType, occurredAt, row.data)
		res, payload := stack.post(t, body, signBody(body))
		requireStatus(t, res, payload, http.StatusOK)

		messages := stack.collect(t, 1, 5*time.Second)
		if len(messages) != 1 {
			t.Fatalf("[row %d] delivered = %d, want 1", index, len(messages))
		}
		if got := stack.system(t, messages[0], "MessageGroupId"); got != row.group {
			t.Errorf("[row %d] MessageGroupId = %q, want %q", index, got, row.group)
		}
		if got := stack.system(t, messages[0], "MessageDeduplicationId"); got != row.eventID {
			t.Errorf("[row %d] MessageDeduplicationId = %q, want the event id %q", index, got, row.eventID)
		}
	}
}

func TestSameEntityRunsInOrder(t *testing.T) {
	stack := newStack(t)
	for i := 1; i <= 5; i++ {
		body := paddleBody(fmt.Sprintf("evt_order_%d", i), "subscription.updated", occurredAt, `{"id":"sub_order"}`)
		res, payload := stack.post(t, body, signBody(body))
		requireStatus(t, res, payload, http.StatusOK)
	}

	messages := stack.collect(t, 5, 10*time.Second)
	if len(messages) != 5 {
		t.Fatalf("delivered = %d, want the whole 5-burst", len(messages))
	}
	// Same group, one delivery lane: the queue must preserve the post order.
	for i, message := range messages {
		got := stack.attr(t, message, "event_id")
		if want := fmt.Sprintf("evt_order_%d", i+1); got != want {
			t.Errorf("position %d carries %q, want %q", i, got, want)
		}
	}
}

func TestDedupCollapsesRepeatDeliveries(t *testing.T) {
	stack := newStack(t)
	body := paddleBody("evt_dedup", "system.notification.tested", occurredAt, `{"note":"once"}`)
	if res, payload := stack.post(t, body, signBody(body)); res.StatusCode != http.StatusOK {
		t.Fatalf("first post status = %d, want 200 (%q)", res.StatusCode, payload)
	}
	// The same event id makes the second post collapse into the first.
	if res, payload := stack.post(t, body, signBody(body)); res.StatusCode != http.StatusOK {
		t.Fatalf("repeat post status = %d, want 200 (%q)", res.StatusCode, payload)
	}
	control := paddleBody("evt_dedup_control", "system.notification.tested", occurredAt, `{"note":"distinct"}`)
	if res, payload := stack.post(t, control, signBody(control)); res.StatusCode != http.StatusOK {
		t.Fatalf("control post status = %d, want 200 (%q)", res.StatusCode, payload)
	}

	messages := stack.collect(t, 2, 5*time.Second)
	if len(messages) != 2 {
		t.Fatalf("delivered = %d, want the deduped pair only", len(messages))
	}
	ids := map[string]bool{
		stack.attr(t, messages[0], "event_id"): true,
		stack.attr(t, messages[1], "event_id"): true,
	}
	if !ids["evt_dedup"] || !ids["evt_dedup_control"] {
		t.Errorf("delivered ids %v, want evt_dedup once and the control", ids)
	}
}

func TestNearCeilingBodyPublishes(t *testing.T) {
	stack := newStack(t)
	body := bodyOfLength(t, "evt_near", 250<<10)
	res, payload := stack.post(t, body, signBody(body))
	requireStatus(t, res, payload, http.StatusOK)

	messages := stack.collect(t, 1, 5*time.Second)
	if len(messages) != 1 {
		t.Fatalf("delivered = %d, want 1", len(messages))
	}
	if len(deref(messages[0].Body)) != 250<<10 {
		t.Errorf("delivered body = %d bytes, want the full %d-byte body", len(deref(messages[0].Body)), 250<<10)
	}
}

// The read clamp sits exactly at the SQS ceiling, and this plane's strict
// budget still accepts a 262144-byte body carrying the full attribute set —
// the ingress bound and the queue's limit agree, so the largest shippable
// request goes through and arrives intact.
func TestExactlyAtTheCeilingPublishes(t *testing.T) {
	stack := newStack(t)
	body := bodyOfLength(t, "evt_ceiling", 256<<10)
	res, payload := stack.post(t, body, signBody(body))
	requireStatus(t, res, payload, http.StatusOK)

	messages := stack.collect(t, 1, 5*time.Second)
	if len(messages) != 1 {
		t.Fatalf("delivered = %d, want 1", len(messages))
	}
	if len(deref(messages[0].Body)) != 256<<10 {
		t.Errorf("delivered body = %d bytes, want the full %d-byte body", len(deref(messages[0].Body)), 256<<10)
	}
}

func pointerText(p *string) string {
	if p == nil {
		return "<nil>"
	}
	return *p
}
