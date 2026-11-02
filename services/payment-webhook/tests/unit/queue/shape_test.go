package queue_test

import (
	"crypto/sha256"
	"encoding/hex"
	"testing"

	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/queue"
)

func TestShapeWalksTheGroupKeyLadder(t *testing.T) {
	cases := map[string]struct {
		body    string
		pwgroup string
	}{
		"subscription rung": {
			body:    `{"event_id":"evt_1","event_type":"subscription.updated","data":{"id":"sub_123"}}`,
			pwgroup: "subscription:sub_123",
		},
		"explicit subscription field": {
			body:    `{"data":{"subscription_id":"sub_456"}}`,
			pwgroup: "subscription:sub_456",
		},
		"camel-case subscription alias": {
			body:    `{"data":{"subscriptionId":"sub_789"}}`,
			pwgroup: "subscription:sub_789",
		},
		"paddle legacy alias": {
			body:    `{"data":{"paddleSubscriptionId":"sub_321"}}`,
			pwgroup: "subscription:sub_321",
		},
		"a bare data.id is no ladder alias, and yields to one": {
			body:    `{"data":{"id":"ctm_1","customer_id":"ctm_9"}}`,
			pwgroup: "customer:ctm_9",
		},
		"a bare data.id alone lands on default": {
			body:    `{"data":{"id":"ctm_1"}}`,
			pwgroup: "default",
		},
		"customer rung": {
			body:    `{"event_type":"payment.succeeded","data":{"customer_id":"ctm_9"}}`,
			pwgroup: "customer:ctm_9",
		},
		"customer camel alias": {
			body:    `{"data":{"customerId":"ctm_8"}}`,
			pwgroup: "customer:ctm_8",
		},
		"userId alias": {
			body:    `{"event_type":"internal.test","data":{"userId":"usr_77"}}`,
			pwgroup: "customer:usr_77",
		},
		"subscription beats customer": {
			body:    `{"data":{"subscription_id":"sub_2","customer_id":"ctm_5"}}`,
			pwgroup: "subscription:sub_2",
		},
		"a sub_-shaped data.id is the subscription rung": {
			body:    `{"data":{"id":"sub_6","customer_id":"ctm_2"}}`,
			pwgroup: "subscription:sub_6",
		},
		"event-type rung": {
			body:    `{"event_type":"refund.created"}`,
			pwgroup: "refund.created",
		},
		"novel event type still groups per type": {
			body:    `{"event_type":"subscription.brand_new_kind"}`,
			pwgroup: "subscription.brand_new_kind",
		},
		"unknown shape lands on default": {
			body:    `{"random_object":true}`,
			pwgroup: "default",
		},
		"malformed body lands on default": {
			body:    `{"broken`,
			pwgroup: "default",
		},
		"event type present but blank lands on default": {
			body:    `{"event_type":"  "}`,
			pwgroup: "default",
		},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			message := queue.Shape([]byte(tc.body))
			if message.GroupID != tc.pwgroup {
				t.Errorf("GroupID = %q, want %q", message.GroupID, tc.pwgroup)
			}
		})
	}
}

func TestShapeStampsThePaddleSource(t *testing.T) {
	message := queue.Shape([]byte(`{"event_id":"evt_1"}`))
	if message.Source != queue.SourcePaddle {
		t.Errorf("Source = %q, want %q — the gateway is Paddle-only, so the stamp is the constant", message.Source, queue.SourcePaddle)
	}
}

func TestShapeForwardsTheBodyVerbatim(t *testing.T) {
	body := []byte(`{"event_id":"evt_1","data":{"id":"sub_1"}}`)
	message := queue.Shape(body)
	if string(message.Body) != string(body) {
		t.Errorf("Body = %q, want the identical bytes", message.Body)
	}
	if &message.Body[0] != &body[0] {
		t.Error("Body is a copy — the passthrough must carry the same slice")
	}
}

func TestShapeNamesUnknownTypes(t *testing.T) {
	message := queue.Shape([]byte(`{"random":true}`))
	if message.EventType != queue.UnknownEventType {
		t.Errorf("EventType = %q, want %q", message.EventType, queue.UnknownEventType)
	}
	recognized := queue.Shape([]byte(`{"event_type":"subscription.updated"}`))
	if recognized.EventType != "subscription.updated" {
		t.Errorf("EventType = %q, want the recognized type", recognized.EventType)
	}
}

func TestShapeComputesTheDedupID(t *testing.T) {
	body := []byte(`{"event_id":"evt_9"}`)
	message := queue.Shape(body)
	if message.DedupID != "evt_9" || message.EventID != "evt_9" {
		t.Errorf("dedup/event = %q/%q, want the parsed event_id", message.DedupID, message.EventID)
	}
	fallback := queue.Shape([]byte(`{"random":true}`))
	sum := sha256.Sum256([]byte(`{"random":true}`))
	if fallback.DedupID != hex.EncodeToString(sum[:]) {
		t.Errorf("DedupID = %q, want the sha256 of the body", fallback.DedupID)
	}
	if fallback.EventID != "" {
		t.Errorf("EventID = %q, want empty so the attribute is omitted", fallback.EventID)
	}
}
