package queue_test

import (
	"context"
	"errors"
	"fmt"
	"net"
	"testing"

	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/events"
	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/queue"
)

const testQueueURL = "https://sqs.eu-central-1.amazonaws.com/123456789012/payment_events.fifo"

func TestSQSAdapterShapesTheFIFOMessage(t *testing.T) {
	target := &fakeSQS{}
	adapter := queue.NewSQSAdapter(target, testQueueURL)
	message := queue.Message{
		Body:           []byte(`{"event_id":"evt_1","event_type":"subscription.updated","data":{"id":"sub_1"}}`),
		Source:         queue.SourcePaddle,
		EventID:        "evt_1",
		DedupID:        "evt_1",
		EventType:      "subscription.updated",
		OccurredAt:     "2026-11-03T13:41:50.041827Z",
		SubscriptionID: "sub_1",
		TransactionID:  "txn_1",
		CustomerID:     "ctm_1",
		UserID:         "usr_1",
		GroupID:        "subscription:sub_1",
	}

	if err := adapter.Publish(context.Background(), message); err != nil {
		t.Fatal(err)
	}
	input := target.input
	if input == nil {
		t.Fatal("SendMessage was not called")
	}
	if derefString(input.QueueUrl) != testQueueURL {
		t.Errorf("QueueUrl = %q, want %q", derefString(input.QueueUrl), testQueueURL)
	}
	if derefString(input.MessageBody) != string(message.Body) {
		t.Errorf("MessageBody = %q, want the body verbatim", derefString(input.MessageBody))
	}
	if derefString(input.MessageDeduplicationId) != "evt_1" {
		t.Errorf("MessageDeduplicationId = %q, want the event id", derefString(input.MessageDeduplicationId))
	}
	if derefString(input.MessageGroupId) != "subscription:sub_1" {
		t.Errorf("MessageGroupId = %q, want the ladder group", derefString(input.MessageGroupId))
	}
	for name, want := range map[string]string{
		"source":          queue.SourcePaddle,
		"event_type":      "subscription.updated",
		"event_id":        "evt_1",
		"occurred_at":     "2026-11-03T13:41:50.041827Z",
		"subscription_id": "sub_1",
		"transaction_id":  "txn_1",
		"customer_id":     "ctm_1",
		"user_id":         "usr_1",
	} {
		attribute, ok := input.MessageAttributes[name]
		if !ok {
			t.Errorf("attribute %q missing", name)
			continue
		}
		if derefString(attribute.DataType) != "String" || derefString(attribute.StringValue) != want {
			t.Errorf("attribute %q = %s/%s, want String/%s", name,
				derefString(attribute.DataType), derefString(attribute.StringValue), want)
		}
	}
	if len(input.MessageAttributes) != 8 {
		t.Errorf("attribute count = %d, want 8", len(input.MessageAttributes))
	}
}

func TestSQSAdapterOmitsTheEmptyAttributes(t *testing.T) {
	target := &fakeSQS{}
	adapter := queue.NewSQSAdapter(target, testQueueURL)
	message := queue.Message{
		Body:      []byte(`{"random":true}`),
		Source:    queue.SourcePaddle,
		DedupID:   "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
		EventType: events.UnknownEventType,
		GroupID:   queue.DefaultGroupID,
	}
	if err := adapter.Publish(context.Background(), message); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"event_id", "occurred_at", "subscription_id", "transaction_id", "customer_id", "user_id"} {
		if _, ok := target.input.MessageAttributes[name]; ok {
			t.Errorf("%s attribute present, want omitted when the payload carries none", name)
		}
	}
	if derefString(target.input.MessageAttributes["event_type"].StringValue) != events.UnknownEventType {
		t.Error("event_type = want the unknown constant, never an empty attribute")
	}
	if len(target.input.MessageAttributes) != 2 {
		t.Errorf("attribute count = %d, want the always-present pair only", len(target.input.MessageAttributes))
	}
}

func TestSQSAdapterMapsTheRetryableSQSFaults(t *testing.T) {
	for _, code := range []string{"ThrottlingException", "InternalFailure", "ServiceUnavailable"} {
		t.Run(code, func(t *testing.T) {
			adapter := queue.NewSQSAdapter(&fakeSQS{err: &apiErr{code: code, msg: code}}, testQueueURL)
			err := adapter.Publish(context.Background(), queue.Message{
				Body: []byte(`{}`), Source: queue.SourcePaddle,
				EventType: events.UnknownEventType, GroupID: queue.DefaultGroupID,
			})
			if !errors.Is(err, queue.ErrEnqueueUnavailable) {
				t.Errorf("err = %v, want ErrEnqueueUnavailable", err)
			}
		})
	}
}

func TestSQSAdapterPassesDeadlinesThrough(t *testing.T) {
	for _, dead := range []error{context.DeadlineExceeded, context.Canceled} {
		adapter := queue.NewSQSAdapter(&fakeSQS{err: dead}, testQueueURL)
		err := adapter.Publish(context.Background(), queue.Message{
			Body: []byte(`{}`), EventType: events.UnknownEventType, GroupID: queue.DefaultGroupID,
		})
		if !errors.Is(err, dead) {
			t.Errorf("err = %v, want %v passed through unmapped", err, dead)
		}
	}
}

func TestSQSAdapterMapsTransportOutagesToUnavailable(t *testing.T) {
	// A queue that is not reachable — refused, reset, wrapped by the SDK's
	// operation shape — earns the same 503 + Retry-After as throttling.
	outages := []error{
		errors.New("connection reset"),
		fmt.Errorf("send: %w", errors.New("connection refused")),
		&net.OpError{Op: "dial", Err: errors.New("connection refused")},
	}
	for _, outage := range outages {
		adapter := queue.NewSQSAdapter(&fakeSQS{err: outage}, testQueueURL)
		err := adapter.Publish(context.Background(), queue.Message{
			Body: []byte(`{}`), EventType: events.UnknownEventType, GroupID: queue.DefaultGroupID,
		})
		if !errors.Is(err, queue.ErrEnqueueUnavailable) {
			t.Errorf("%v → err = %v, want ErrEnqueueUnavailable", outage, err)
		}
	}
}

func TestSQSAdapterKeepsUnexpectedFaultsUnmapped(t *testing.T) {
	// The remaining SQS codes can never succeed, so they stay unmapped for the 500 row.
	adapter := queue.NewSQSAdapter(&fakeSQS{err: &apiErr{code: "AWS.SimpleQueueService.NonExistentQueue", msg: "dne"}}, testQueueURL)
	err := adapter.Publish(context.Background(), queue.Message{
		Body: []byte(`{}`), EventType: events.UnknownEventType, GroupID: queue.DefaultGroupID,
	})
	if err == nil || errors.Is(err, queue.ErrEnqueueUnavailable) {
		t.Errorf("err = %v, want an unmapped error bound for the 500 row", err)
	}
}

func derefString(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}
