package handlers_test

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/handlers"
	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/observability"
	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/queue"
	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/validator"
)

const testSecret = "change-me-min-16-chars"

// max is shrunk so an oversize body is a cheap test literal.
const max = int64(1024)

// 1.5 s budget: Retry-After carries the ceil, so the 503 asserts 2.
const testBudget = 1500 * time.Millisecond

// The handler runs the real validator over a fake Queue; tests never touch a network.
type fakeQueue struct {
	message queue.Message
	err     error
}

func (f *fakeQueue) Publish(_ context.Context, message queue.Message) error {
	f.message = message
	return f.err
}

func newHandler(target queue.Queue) gin.HandlerFunc {
	gin.SetMode(gin.TestMode)
	return handlers.NewPaddleWebhook(validator.NewPaddle(testSecret), max, queue.NewService(target, testBudget), observability.NullTelemetry{})
}

func serve(t *testing.T, w *httptest.ResponseRecorder, req *http.Request, handler gin.HandlerFunc) {
	t.Helper()
	c, _ := gin.CreateTestContext(w)
	c.Request = req
	handler(c)
}

func sign(sec, ts string, body []byte) string {
	mac := hmac.New(sha256.New, []byte(sec))
	mac.Write([]byte(ts + ":"))
	mac.Write(body)
	return fmt.Sprintf("ts=%s;h1=%s", ts, hex.EncodeToString(mac.Sum(nil)))
}

func freshTS(t *testing.T) string {
	t.Helper()
	return strconv.FormatInt(time.Now().Unix(), 10)
}

func post(t *testing.T, target queue.Queue, body []byte, header string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/webhook/paddle", bytesOfReader(body))
	if header != "" {
		req.Header.Set("Paddle-Signature", header)
	}
	w := httptest.NewRecorder()
	serve(t, w, req, newHandler(target))
	return w
}

// A fixed event id and sub_-prefixed data.id keep the dedup/group assertions stable.
const validEventID = "ntfsimevt_01m6dk7m1cmrykjg0da6qt2tke"
const validGroupID = "subscription:sub_01hv8x29kz0t586xy6zn1a62ny"

func validBody() []byte {
	return []byte(`{"event_id":"` + validEventID + `","event_type":"subscription.updated","occurred_at":"2026-11-02T07:40:26.540606Z","notification_id":"ntfsimntf_01m6dk7m3h1gz9pfrhc9t33ty2","data":{"id":"sub_01hv8x29kz0t586xy6zn1a62ny"}}`)
}

func TestPaddleWebhookQueuesValidEvents(t *testing.T) {
	for name, body := range map[string][]byte{
		"small body":        validBody(),
		"exactly the bound": paddedEnvelope(t, max), // max is legal; max+1 is not
	} {
		t.Run(name, func(t *testing.T) {
			target := &fakeQueue{}
			w := post(t, target, body, sign(testSecret, freshTS(t), body))
			if w.Code != http.StatusOK {
				t.Errorf("status = %d, want 200", w.Code)
			}
			if body := w.Body.String(); body != `{"status":"queued"}` {
				t.Errorf("body = %q, want the queued envelope", body)
			}
			if target.message.Source != queue.SourcePaddle {
				t.Errorf("Source = %q, want %q", target.message.Source, queue.SourcePaddle)
			}
			if target.message.DedupID != validEventID {
				t.Errorf("DedupID = %q, want the parsed event_id", target.message.DedupID)
			}
			if target.message.GroupID != validGroupID {
				t.Errorf("GroupID = %q, want the subscription rung", target.message.GroupID)
			}
			if target.message.EventID != validEventID || target.message.EventType != "subscription.updated" {
				t.Errorf("attrs = %q/%q, want the event_id and event_type carried", target.message.EventID, target.message.EventType)
			}
		})
	}
}

func TestPaddleWebhookRejectsBadSignaturesIdentically(t *testing.T) {
	body := validBody()
	cases := map[string]string{
		"missing":        "",
		"foreign secret": sign("another-secret-16-ch", freshTS(t), body),
		"tampered body":  sign(testSecret, freshTS(t), []byte(`{"event_type":"other"}`)),
		"stale":          sign(testSecret, strconv.FormatInt(time.Now().Unix()-301, 10), body),
		"malformed":      "garbage",
	}
	bodies := map[string]string{}
	for name, header := range cases {
		t.Run(name, func(t *testing.T) {
			w := post(t, &fakeQueue{}, body, header)
			if w.Code != http.StatusUnauthorized {
				t.Errorf("status = %d, want 401", w.Code)
			}
			if header := w.Header().Get("WWW-Authenticate"); header != "" {
				t.Errorf("WWW-Authenticate = %q, want absent", header)
			}
			bodies[name] = w.Body.String()
		})
	}
	for name, envelope := range bodies {
		if envelope != `{"error":"unauthorized"}` {
			t.Errorf("%s body = %q, want the generic unauthorized envelope on every class", name, envelope)
		}
	}
}

func TestPaddleWebhookRejectsEnvelopeViolationsBeforeQueue(t *testing.T) {
	cases := map[string]struct {
		body []byte
		want string
	}{
		"missing two hard fields": {
			[]byte(`{"event_id":"ntfsimevt_01m6dk7m1cmrykjg0da6qt2tke","event_type":"subscription.updated"}`),
			`{"error":"payload rejected by the envelope check","missing":["data","occurred_at"]}`,
		},
		"blank event_id": {
			[]byte(`{"event_id":"  ","event_type":"subscription.updated","occurred_at":"2026-11-02T07:40:26.540606Z","data":{}}`),
			`{"error":"payload rejected by the envelope check","missing":["event_id"]}`,
		},
		"unparseable occurred_at": {
			[]byte(`{"event_id":"evt_1","event_type":"subscription.updated","occurred_at":"not a time","data":{}}`),
			`{"error":"payload rejected by the envelope check","missing":["occurred_at"]}`,
		},
		"array data": {
			[]byte(`{"event_id":"evt_1","event_type":"subscription.updated","occurred_at":"2026-11-02T07:40:26.540606Z","data":[1]}`),
			`{"error":"payload rejected by the envelope check","missing":["data"]}`,
		},
		"non-object payload": {
			[]byte(`[1,2,3]`),
			`{"error":"payload rejected by the envelope check","missing":["payload"]}`,
		},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			target := &fakeQueue{}
			w := signedPost(t, target, tc.body)
			if w.Code != http.StatusUnprocessableEntity {
				t.Fatalf("status = %d, want 422", w.Code)
			}
			if body := w.Body.String(); body != tc.want {
				t.Errorf("body = %q, want the named rejection", body)
			}
			if target.message.Source != "" {
				t.Errorf("Source = %q, want zero — a 422 never publishes", target.message.Source)
			}
			if header := w.Header().Get("Retry-After"); header != "" {
				t.Errorf("Retry-After = %q, want absent on the envelope row", header)
			}
		})
	}
}

func TestPaddleWebhookChecksTheSignatureBeforeTheEnvelope(t *testing.T) {
	// Verify-first gate order: an unsigned body never reaches the envelope check.
	w := post(t, &fakeQueue{}, []byte(`[1,2,3]`), "garbage")
	if w.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401", w.Code)
	}
}

func TestPaddleWebhookBoundsTheBodyBeforeAuth(t *testing.T) {
	// The bound precedes auth: an oversize unsigned body still answers 413.
	w := post(t, &fakeQueue{}, bytesOf(max+1), "garbage")
	if w.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, want 413", w.Code)
	}
	if want := fmt.Sprintf(`{"error":"request body exceeds %d bytes"}`, max); w.Body.String() != want {
		t.Errorf("body = %q, want the limit named", w.Body.String())
	}
}

func TestPaddleWebhookAnswers400OnUnreadableBodies(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/api/v1/webhook/paddle",
		io.MultiReader(strings.NewReader(`{"start"`), brokenReader{}))
	w := httptest.NewRecorder()
	serve(t, w, req, newHandler(&fakeQueue{}))
	if w.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", w.Code)
	}
	if body := w.Body.String(); body != `{"error":"request body is unreadable"}` {
		t.Errorf("body = %q, want the unreadable envelope", body)
	}
}

func TestPaddleWebhookShapesTheRetryable503(t *testing.T) {
	for name, err := range map[string]error{
		"enqueue unavailable": queue.ErrEnqueueUnavailable,
		"deadline exceeded":   queue.ErrDeadlineExceeded,
	} {
		t.Run(name, func(t *testing.T) {
			body := validBody()
			w := post(t, &fakeQueue{err: err}, body, sign(testSecret, freshTS(t), body))
			if w.Code != http.StatusServiceUnavailable {
				t.Fatalf("status = %d, want 503", w.Code)
			}
			if after := w.Header().Get("Retry-After"); after != "2" {
				t.Errorf("Retry-After = %q, want the 1.5s budget ceil as 2", after)
			}
			if body := w.Body.String(); body != `{"error":"queue unavailable","retryable":true}` {
				t.Errorf("body = %q, want the retryable envelope", body)
			}
		})
	}
}

func TestPaddleWebhookAnswersThe500CatchAll(t *testing.T) {
	// An unmapped fault answers the generic 500, with no Retry-After.
	w := post(t, &fakeQueue{err: errors.New("connection reset")},
		validBody(), sign(testSecret, freshTS(t), validBody()))
	if w.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", w.Code)
	}
	if body := w.Body.String(); body != `{"error":"unexpected error"}` {
		t.Errorf("body = %q, want the generic envelope", body)
	}
	if header := w.Header().Get("Retry-After"); header != "" {
		t.Errorf("Retry-After = %q, want absent on the non-retryable row", header)
	}
}

func signedPost(t *testing.T, target queue.Queue, body []byte) *httptest.ResponseRecorder {
	t.Helper()
	return post(t, target, body, sign(testSecret, freshTS(t), body))
}

// paddedEnvelope pads with JSON whitespace so an exactly-n-byte body still
// carries a full valid envelope.
func paddedEnvelope(t *testing.T, n int64) []byte {
	t.Helper()
	base := validBody()
	if int64(len(base)) > n {
		t.Fatalf("valid body is %d bytes, beyond the %d bound it must pad to", len(base), n)
	}
	body := make([]byte, n)
	copy(body, base)
	for i := len(base); i < int(n); i++ {
		body[i] = ' '
	}
	return body
}

// brokenReader faults the transport mid-body to drive the 400 class.
type brokenReader struct{}

func (brokenReader) Read([]byte) (int, error) { return 0, io.ErrUnexpectedEOF }

func bytesOfReader(body []byte) io.Reader {
	return strings.NewReader(string(body))
}

// bytesOf pads a marker to n bytes so data loss is self-evident.
func bytesOf(n int64) []byte {
	const marker = "xq9z"
	body := make([]byte, 0, n)
	for int64(len(body)) < n {
		body = append(body, marker...)
	}
	return body[:n]
}
