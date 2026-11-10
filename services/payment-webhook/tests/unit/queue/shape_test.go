package queue_test

import (
	"crypto/sha256"
	"encoding/hex"
	"testing"

	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/events"
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
		"camel-case spellings are no ladder input": {
			body:    `{"data":{"subscriptionId":"sub_789","customer_id":"ctm_9"}}`,
			pwgroup: "customer:ctm_9",
		},
		"an explicit field beats the prefix guard": {
			body:    `{"data":{"id":"ctm_1","customer_id":"ctm_9"}}`,
			pwgroup: "customer:ctm_9",
		},
		"prefix-matched data.id is the customer rung": {
			body:    `{"event_type":"customer.updated","data":{"id":"ctm_1"}}`,
			pwgroup: "customer:ctm_1",
		},
		"a plain data.id alone lands on default": {
			body:    `{"data":{"id":"randomvalue"}}`,
			pwgroup: "default",
		},
		"customer rung": {
			body:    `{"event_type":"payment.succeeded","data":{"customer_id":"ctm_9"}}`,
			pwgroup: "customer:ctm_9",
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

func TestShapeExtractsTheIdentifierAttributes(t *testing.T) {
	cases := map[string]struct {
		body             string
		sub, txn         string
		cust, user       string
		occurred, pwtype string
	}{
		"subscription.created links its first billing transaction": {
			body:     `{"event_id":"evt_1","event_type":"subscription.created","occurred_at":"2026-11-03T13:41:50.041827Z","data":{"id":"sub_1","transaction_id":"txn_1","customer_id":"ctm_1"}}`,
			sub:      "sub_1",
			txn:      "txn_1",
			cust:     "ctm_1",
			occurred: "2026-11-03T13:41:50.041827Z",
			pwtype:   "subscription.created",
		},
		"transaction.update carries the subscription and its own txn id": {
			body:     `{"event_type":"transaction.updated","occurred_at":"2026-11-03T13:41:51Z","data":{"id":"txn_1","subscription_id":"sub_1","customer_id":"ctm_1"}}`,
			sub:      "sub_1",
			txn:      "txn_1",
			cust:     "ctm_1",
			occurred: "2026-11-03T13:41:51Z",
			pwtype:   "transaction.updated",
		},
		"customer.created has only the customer's own id": {
			body:   `{"event_type":"customer.created","data":{"id":"ctm_1"}}`,
			cust:   "ctm_1",
			pwtype: "customer.created",
		},
		"payment_method.saved has no subscription to link": {
			body:     `{"event_type":"payment_method.saved","occurred_at":"2026-11-03T13:41:52Z","data":{"id":"pm_1","customer_id":"ctm_1"}}`,
			cust:     "ctm_1",
			occurred: "2026-11-03T13:41:52Z",
			pwtype:   "payment_method.saved",
		},
		"the checkout custom data carries the user id": {
			body:     `{"event_type":"subscription.created","occurred_at":"2026-11-03T13:41:50Z","data":{"id":"sub_1","custom_data":{"user_id":"usr_77"}}}`,
			sub:      "sub_1",
			user:     "usr_77",
			occurred: "2026-11-03T13:41:50Z",
			pwtype:   "subscription.created",
		},
		"a foreign shape answers the zero ids": {
			body:   `{"random_object":true}`,
			pwtype: "unknown",
		},
		"non-string custom data values are ignored, not fatal": {
			body:   `{"event_type":"transaction.updated","data":{"custom_data":{"user_id":77,"note":"carry"}}}`,
			pwtype: "transaction.updated",
		},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			message := queue.Shape([]byte(tc.body))
			if message.SubscriptionID != tc.sub {
				t.Errorf("SubscriptionID = %q, want %q", message.SubscriptionID, tc.sub)
			}
			if message.TransactionID != tc.txn {
				t.Errorf("TransactionID = %q, want %q", message.TransactionID, tc.txn)
			}
			if message.CustomerID != tc.cust {
				t.Errorf("CustomerID = %q, want %q", message.CustomerID, tc.cust)
			}
			if message.UserID != tc.user {
				t.Errorf("UserID = %q, want %q", message.UserID, tc.user)
			}
			if message.OccurredAt != tc.occurred {
				t.Errorf("OccurredAt = %q, want %q", message.OccurredAt, tc.occurred)
			}
			if message.EventType != tc.pwtype {
				t.Errorf("EventType = %q, want %q", message.EventType, tc.pwtype)
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
	if message.EventType != events.UnknownEventType {
		t.Errorf("EventType = %q, want %q", message.EventType, events.UnknownEventType)
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
