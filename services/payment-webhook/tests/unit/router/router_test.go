package router_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/config"
	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/queue"
	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/router"
)

const sharedKey = "change-me-min-16-chars"

// The engine mounts a fake queue: router tests answer wiring questions, and
// touching an SQS endpoint for real is not one of them (design.md).
type fakeQueue struct {
	published []queue.Message
	err       error
}

func (f *fakeQueue) Publish(_ context.Context, message queue.Message) error {
	if f.err != nil {
		return f.err
	}
	f.published = append(f.published, message)
	return nil
}

func newEngine(t *testing.T, target queue.Queue) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	return router.New(config.Config{
		APIKey:       sharedKey,
		PaddleSecret: sharedKey,
		MaxBodyBytes: 1 << 20,
	}, queue.NewService(target, 1500*time.Millisecond))
}

func postInternal(t *testing.T, target queue.Queue, key string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/internal/events", nil)
	if key != "" {
		req.Header.Set("x-api-key", key)
	}
	w := httptest.NewRecorder()
	newEngine(t, target).ServeHTTP(w, req)
	return w
}

func TestInternalEventRejectsMissingAndForeignKeysIdentically(t *testing.T) {
	target := &fakeQueue{}
	rejections := map[string]string{}
	for name, key := range map[string]string{"missing": "", "foreign": "another-secret-16-key"} {
		t.Run(name, func(t *testing.T) {
			w := postInternal(t, target, key)
			if w.Code != http.StatusUnauthorized {
				t.Errorf("status = %d, want 401", w.Code)
			}
			if body := w.Body.String(); body != `{"error":"unauthorized"}` {
				t.Errorf("body = %q, want the generic unauthorized envelope", body)
			}
			if header := w.Header().Get("WWW-Authenticate"); header != "" {
				t.Errorf("WWW-Authenticate = %q, want absent", header)
			}
			rejections[name] = w.Body.String()
		})
	}
	if rejections["missing"] != rejections["foreign"] {
		t.Errorf("missing body %q differs from foreign body %q; the failure classes must look identical",
			rejections["missing"], rejections["foreign"])
	}
	if len(target.published) != 0 {
		t.Errorf("a rejected call published %d messages; auth must precede the queue", len(target.published))
	}
}

func TestInternalEventServesWithTheSharedKey(t *testing.T) {
	target := &fakeQueue{}
	w := postInternal(t, target, sharedKey)
	if w.Code != http.StatusOK {
		t.Errorf("status = %d, want 200", w.Code)
	}
	if body := w.Body.String(); body != `{"status":"queued"}` {
		t.Errorf("body = %q, want the queued envelope", body)
	}
	if len(target.published) != 1 {
		t.Fatalf("published = %d, want one message through the mounted service", len(target.published))
	}
	if target.published[0].Source != queue.SourceInternal {
		t.Errorf("Source = %q, want %q", target.published[0].Source, queue.SourceInternal)
	}
}

func TestInternalFaceShapesTheRetryable503(t *testing.T) {
	w := postInternal(t, &fakeQueue{err: queue.ErrEnqueueUnavailable}, sharedKey)
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", w.Code)
	}
	if after := w.Header().Get("Retry-After"); after != "2" {
		t.Errorf("Retry-After = %q, want the 1.5s budget ceil as 2", after)
	}
	if body := w.Body.String(); body != `{"error":"queue unavailable","retryable":true}` {
		t.Errorf("body = %q, want the retryable envelope", body)
	}
}

func TestReaderBoundClampsToTheSQSCeiling(t *testing.T) {
	// MAX_BODY_BYTES rides at 1 MiB while SQS accepts 262144 bytes at most:
	// the wiring shrinks the bound, so the 413 names the ceiling.
	target := &fakeQueue{}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/internal/events",
		strings.NewReader(strings.Repeat("x", 262145)))
	req.Header.Set("x-api-key", sharedKey)
	w := httptest.NewRecorder()
	newEngine(t, target).ServeHTTP(w, req)
	if w.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, want 413", w.Code)
	}
	if body := w.Body.String(); body != `{"error":"request body exceeds 262144 bytes"}` {
		t.Errorf("body = %q, want the SQS ceiling named", body)
	}
	if len(target.published) != 0 {
		t.Errorf("an unshippable body reached the queue %d times", len(target.published))
	}
}

func TestPaddleFaceRequiresAValidSignature(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/api/v1/webhook/paddle", nil)
	w := httptest.NewRecorder()
	newEngine(t, &fakeQueue{}).ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401 from the signature guard, not a framework default", w.Code)
	}
	if body := w.Body.String(); body != `{"error":"unauthorized"}` {
		t.Errorf("body = %q, want the generic unauthorized envelope", body)
	}
	if header := w.Header().Get("WWW-Authenticate"); header != "" {
		t.Errorf("WWW-Authenticate = %q, want absent", header)
	}
}
