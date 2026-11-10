package handlers_test

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/handlers"
	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/observability"
	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/queue"
	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/validator"
)

// recordingTelemetry is the verdict black box: it collects what every site on
// the webhook face said, one fake spanning the whole verdict matrix.
type recordingTelemetry struct {
	spans              []string
	bodyErrors         []observability.Reason
	invalidSignatures  int
	envelopeRejections []string
	envelopeAdvisories []observability.AdvisoryReason
	received           []string
	unknown            int
	published          []string
}

func (r *recordingTelemetry) TrackProcessing(ctx context.Context, eventType, eventID string) (context.Context, func()) {
	r.spans = append(r.spans, eventType+"/"+eventID)
	return ctx, func() {}
}

func (r *recordingTelemetry) RecordBodyError(reason observability.Reason) {
	r.bodyErrors = append(r.bodyErrors, reason)
}

func (r *recordingTelemetry) RecordInvalidSignature() {
	r.invalidSignatures++
}

func (r *recordingTelemetry) RecordEnvelopeRejection(reason string) {
	r.envelopeRejections = append(r.envelopeRejections, reason)
}

func (r *recordingTelemetry) RecordEnvelopeAdvisory(reason observability.AdvisoryReason) {
	r.envelopeAdvisories = append(r.envelopeAdvisories, reason)
}

func (r *recordingTelemetry) RecordReceived(eventType string) {
	r.received = append(r.received, eventType)
}

func (r *recordingTelemetry) RecordUnknownEventType() {
	r.unknown++
}

func (r *recordingTelemetry) RecordPublish(eventType string, status observability.PublishStatus, _ time.Duration) {
	r.published = append(r.published, eventType+"/"+string(status))
}

func (r *recordingTelemetry) Shutdown(context.Context) error { return nil }

// verdictWant carries the exact verdict rows the case must record.
type verdictWant struct {
	status             int
	spans              []string
	received           []string
	unknown            int
	published          []string
	invalidSignatures  int
	envelopeRejections []string
	envelopeAdvisories []observability.AdvisoryReason
	bodyErrors         []observability.Reason
}

func TestPaddleWebhookVerdictsAreRecorded(t *testing.T) {
	cases := map[string]struct {
		body     []byte
		sign     bool
		queueErr error
		want     verdictWant
	}{
		"signed valid enqueues and records": {
			body: validBody(),
			sign: true,
			want: verdictWant{
				status:    http.StatusOK,
				spans:     []string{"subscription.updated/" + validEventID},
				received:  []string{"subscription.updated"},
				published: []string{"subscription.updated/success"},
			},
		},
		"a parse-defeating body rides as unknown": {
			body: []byte(`{"event_id":"evt_unknown_1","event_type":"checkout.created","occurred_at":"2026-11-02T07:40:26.540606Z","notification_id":"ntf_1","data":{"custom_data":"not-an-object"}}`),
			sign: true,
			want: verdictWant{
				status: http.StatusOK,
				// The defeated parse settles to the unknown/advisory rows (FR-7).
				spans:              []string{"unknown/"},
				received:           []string{"unknown"},
				unknown:            1,
				envelopeAdvisories: []observability.AdvisoryReason{"addressable_id"},
				published:          []string{"unknown/success"},
			},
		},
		"a body without notification_id queues with the advisory": {
			body: []byte(`{"event_id":"` + validEventID + `","event_type":"subscription.updated","occurred_at":"2026-11-02T07:40:26.540606Z","data":{"id":"sub_01hv8x29kz0t586xy6zn1a62ny"}}`),
			sign: true,
			want: verdictWant{
				status:             http.StatusOK,
				spans:              []string{"subscription.updated/" + validEventID},
				received:           []string{"subscription.updated"},
				envelopeAdvisories: []observability.AdvisoryReason{"notification_id"},
				published:          []string{"subscription.updated/success"},
			},
		},
		"an unaddressable body advises the group ladder": {
			body: []byte(`{"event_id":"evt_2","event_type":"checkout.completed","occurred_at":"2026-11-02T07:40:26.540606Z","notification_id":"ntf_2","data":{"id":"norun_notanentity"}}`),
			sign: true,
			want: verdictWant{
				status:             http.StatusOK,
				spans:              []string{"checkout.completed/evt_2"},
				received:           []string{"checkout.completed"},
				envelopeAdvisories: []observability.AdvisoryReason{"addressable_id"},
				published:          []string{"checkout.completed/success"},
			},
		},
		"an unsigned body only counts the signature rejection": {
			body: validBody(),
			want: verdictWant{
				status:            http.StatusUnauthorized,
				invalidSignatures: 1,
			},
		},
		"an envelope violation rejects with the named fields": {
			body: []byte(`{"event_id":"evt_3","event_type":"subscription.updated"}`),
			sign: true,
			want: verdictWant{
				status:             http.StatusUnprocessableEntity,
				envelopeRejections: []string{"data,occurred_at"},
			},
		},
		"a deadline-bound publish is the timeout verdict": {
			body:     validBody(),
			sign:     true,
			queueErr: context.DeadlineExceeded,
			want: verdictWant{
				status:    http.StatusServiceUnavailable,
				spans:     []string{"subscription.updated/" + validEventID},
				received:  []string{"subscription.updated"},
				published: []string{"subscription.updated/timeout"},
			},
		},
		"a send fault is the error verdict": {
			body:     validBody(),
			sign:     true,
			queueErr: errors.New("connection reset"),
			want: verdictWant{
				status:    http.StatusInternalServerError,
				spans:     []string{"subscription.updated/" + validEventID},
				received:  []string{"subscription.updated"},
				published: []string{"subscription.updated/error"},
			},
		},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			obs := &recordingTelemetry{}
			handler := handlers.NewPaddleWebhook(validator.NewPaddle(testSecret), max,
				queue.NewService(&fakeQueue{err: tc.queueErr}, testBudget), obs)
			req := httptest.NewRequest(http.MethodPost, "/api/v1/webhook/paddle", strings.NewReader(string(tc.body)))
			if tc.sign {
				req.Header.Set("Paddle-Signature", sign(testSecret, freshTS(t), tc.body))
			}
			w := httptest.NewRecorder()
			serve(t, w, req, handler)
			if w.Code != tc.want.status {
				t.Errorf("status = %d, want %d", w.Code, tc.want.status)
			}
			assertVerdict(t, obs, tc.want)
		})
	}
}

// Drives the 400 transport fault through the seam beside the too_large row.
func TestPaddleWebhookRecordsTheUnreadableReason(t *testing.T) {
	obs := &recordingTelemetry{}
	handler := handlers.NewPaddleWebhook(validator.NewPaddle(testSecret), max,
		queue.NewService(&fakeQueue{}, testBudget), obs)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/webhook/paddle",
		io.MultiReader(strings.NewReader(`{"start"`), brokenReader{}))
	w := httptest.NewRecorder()
	serve(t, w, req, handler)
	if w.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", w.Code)
	}
	assertVerdict(t, obs, verdictWant{
		status:     http.StatusBadRequest,
		bodyErrors: []observability.Reason{observability.ReasonUnreadable},
	})
}

// An oversize unsigned body still lands in the body-error counter.
func TestPaddleWebhookRecordsTheTooLargeReason(t *testing.T) {
	obs := &recordingTelemetry{}
	handler := handlers.NewPaddleWebhook(validator.NewPaddle(testSecret), max,
		queue.NewService(&fakeQueue{}, testBudget), obs)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/webhook/paddle", strings.NewReader(string(bytesOf(max+1))))
	req.Header.Set("Paddle-Signature", "garbage")
	w := httptest.NewRecorder()
	serve(t, w, req, handler)
	if w.Code != http.StatusRequestEntityTooLarge {
		t.Errorf("status = %d, want 413", w.Code)
	}
	assertVerdict(t, obs, verdictWant{
		status:     http.StatusRequestEntityTooLarge,
		bodyErrors: []observability.Reason{observability.ReasonTooLarge},
	})
}

func assertVerdict(t *testing.T, got *recordingTelemetry, want verdictWant) {
	t.Helper()
	if !slices.Equal(got.spans, want.spans) {
		t.Errorf("spans = %v, want %v", got.spans, want.spans)
	}
	if !slices.Equal(got.received, want.received) {
		t.Errorf("received = %v, want %v", got.received, want.received)
	}
	if !slices.Equal(got.published, want.published) {
		t.Errorf("published = %v, want %v", got.published, want.published)
	}
	if !slices.Equal(got.envelopeRejections, want.envelopeRejections) {
		t.Errorf("envelopeRejections = %v, want %v", got.envelopeRejections, want.envelopeRejections)
	}
	if !slices.Equal(got.envelopeAdvisories, want.envelopeAdvisories) {
		t.Errorf("envelopeAdvisories = %v, want %v", got.envelopeAdvisories, want.envelopeAdvisories)
	}
	if !slices.Equal(got.bodyErrors, want.bodyErrors) {
		t.Errorf("bodyErrors = %v, want %v", got.bodyErrors, want.bodyErrors)
	}
	if got.invalidSignatures != want.invalidSignatures {
		t.Errorf("invalidSignatures = %d, want %d", got.invalidSignatures, want.invalidSignatures)
	}
	if got.unknown != want.unknown {
		t.Errorf("unknown count = %d, want %d", got.unknown, want.unknown)
	}
}
