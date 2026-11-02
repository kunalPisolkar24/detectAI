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
	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/queue"
	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/validator"
)

const testSecret = "change-me-min-16-chars"

// max is shrunk from the 1 MiB default so an oversize body is a cheap test
// literal instead of a megabyte allocation.
const max = int64(1024)

// The 1.5 s budget: Retry-After carries its ceil, so the shaped 503 asserts 2.
const testBudget = 1500 * time.Millisecond

// The handler matrix runs the real validator; the transport is the fake Queue
// seam — the one place a unit test may not touch a network (design.md).
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
	return handlers.NewPaddleWebhook(validator.NewPaddle(testSecret), max, queue.NewService(target, testBudget))
}

// serve runs the mounted handler over a fresh test context wired to w.
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

func validBody() []byte {
	return []byte(`{"event_type":"subscription.updated"}`)
}

func TestPaddleWebhookQueuesValidEvents(t *testing.T) {
	for name, body := range map[string][]byte{
		"small body":        validBody(),
		"exactly the bound": bytesOf(max), // max is legal; max+1 is not
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

func TestPaddleWebhookBoundsTheBodyBeforeAuth(t *testing.T) {
	// An oversize body with a garbage signature still answers 413: the bound
	// precedes any auth work (NFR-4), so the caller gets the failure it caused.
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
	// An unmapped transport fault is not retryable vocabulary: generic 500,
	// no Retry-After row (design.md taxonomy).
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
