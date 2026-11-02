package queue_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/queue"
)

// fakeQueue captures the shaped message and answers the configured error.
type fakeQueue struct {
	message queue.Message
	err     error
}

func (f *fakeQueue) Publish(ctx context.Context, message queue.Message) error {
	f.message = message
	return f.err
}

func TestServiceShapesAndForwards(t *testing.T) {
	target := &fakeQueue{}
	svc := queue.NewService(target, 5*time.Second)
	body := []byte(`{"event_id":"evt_1","event_type":"subscription.updated","data":{"id":"sub_1"}}`)

	if err := svc.Publish(context.Background(), body, queue.SourcePaddle); err != nil {
		t.Fatal(err)
	}
	if target.message.GroupID != "subscription:sub_1" {
		t.Errorf("GroupID = %q, want the ladder-shaped group", target.message.GroupID)
	}
	if string(target.message.Body) != string(body) {
		t.Errorf("Body = %q, want verbatim", target.message.Body)
	}
	if target.message.Source != queue.SourcePaddle {
		t.Errorf("Source = %q, want %q", target.message.Source, queue.SourcePaddle)
	}
}

func TestServiceMapsTheBudgetDeadline(t *testing.T) {
	svc := queue.NewService(&fakeQueue{err: context.DeadlineExceeded}, time.Second)
	err := svc.Publish(context.Background(), []byte(`{}`), queue.SourcePaddle)
	if !errors.Is(err, queue.ErrDeadlineExceeded) {
		t.Errorf("err = %v, want ErrDeadlineExceeded", err)
	}
}

func TestServiceAnswersTheDeadlineWhenTheCallerDies(t *testing.T) {
	// A client disconnect or a drain cancels the caller context mid-publish;
	// with the transport presumably already back, that ambiguity still maps to
	// ErrDeadlineExceeded — the dedup id makes replay harmless (NFR-3).
	parent, cancel := context.WithCancel(context.Background())
	cancel()
	svc := queue.NewService(&fakeQueue{}, time.Hour)
	err := svc.Publish(parent, []byte(`{}`), queue.SourcePaddle)
	if !errors.Is(err, queue.ErrDeadlineExceeded) {
		t.Errorf("err = %v, want ErrDeadlineExceeded", err)
	}
}

func TestServicePassesTransportVocabularyThrough(t *testing.T) {
	svc := queue.NewService(&fakeQueue{err: queue.ErrEnqueueUnavailable}, time.Hour)
	err := svc.Publish(context.Background(), []byte(`{}`), queue.SourcePaddle)
	if !errors.Is(err, queue.ErrEnqueueUnavailable) {
		t.Errorf("err = %v, want ErrEnqueueUnavailable passed through", err)
	}
}

func TestServiceAnswersTheBudgetBack(t *testing.T) {
	if budget := queue.NewService(&fakeQueue{}, 1500*time.Millisecond).Budget(); budget != 1500*time.Millisecond {
		t.Errorf("Budget = %v, want the configured value", budget)
	}
}
