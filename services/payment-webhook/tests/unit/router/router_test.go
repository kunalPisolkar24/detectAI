package router_test

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/config"
	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/observability"
	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/queue"
	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/router"
)

const paddleSecret = "change-me-min-16-chars"

// The engine mounts a fake queue; router tests never touch SQS.
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
		PaddleSecret: paddleSecret,
		MaxBodyBytes: 1 << 20,
	}, queue.NewService(target, 1500*time.Millisecond), observability.NullTelemetry{})
}

func TestPaddleFacePublishesASignedBody(t *testing.T) {
	target := &fakeQueue{}
	ts := strconv.FormatInt(time.Now().Unix(), 10)
	body := []byte(`{"event_id":"evt_router","event_type":"subscription.updated","occurred_at":"2026-11-02T07:40:26.540606Z","data":{"id":"sub_1"}}`)
	mac := hmac.New(sha256.New, []byte(paddleSecret))
	mac.Write([]byte(ts + ":"))
	mac.Write(body)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/webhook/paddle", strings.NewReader(string(body)))
	req.Header.Set("Paddle-Signature", "ts="+ts+";h1="+hex.EncodeToString(mac.Sum(nil)))
	w := httptest.NewRecorder()
	newEngine(t, target).ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}
	if body := w.Body.String(); body != `{"status":"queued"}` {
		t.Errorf("body = %q, want the queued envelope", body)
	}
	if len(target.published) != 1 {
		t.Fatalf("published = %d, want one message through the mounted service", len(target.published))
	}
	if target.published[0].Source != queue.SourcePaddle {
		t.Errorf("Source = %q, want %q", target.published[0].Source, queue.SourcePaddle)
	}
}

func TestInternalFaceIsRetired(t *testing.T) {
	target := &fakeQueue{}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/internal/events", nil)
	req.Header.Set("x-api-key", paddleSecret)
	w := httptest.NewRecorder()
	newEngine(t, target).ServeHTTP(w, req)
	if w.Code != http.StatusNotFound {
		t.Errorf("status = %d, want the framework's 404", w.Code)
	}
	if len(target.published) != 0 {
		t.Errorf("the retired face published %d messages", len(target.published))
	}
}

func TestProbesMoveUnderTheAPIv1Prefix(t *testing.T) {
	engine := newEngine(t, &fakeQueue{})
	paths := map[string]string{
		"/api/v1/health": `{"status":"ok"}`,
		"/api/v1/ready":  `{"status":"ready"}`,
	}
	for path, want := range paths {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		w := httptest.NewRecorder()
		engine.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Errorf("GET %s = %d, want 200", path, w.Code)
		}
		if got := w.Body.String(); got != want {
			t.Errorf("GET %s body = %q, want %q", path, got, want)
		}
	}
	for _, path := range []string{"/health", "/ready"} {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		w := httptest.NewRecorder()
		engine.ServeHTTP(w, req)
		if w.Code != http.StatusNotFound {
			t.Errorf("GET %s = %d, want the framework's 404", path, w.Code)
		}
	}
}

func TestReaderBoundClampsToTheSQSCeiling(t *testing.T) {
	target := &fakeQueue{}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/webhook/paddle",
		strings.NewReader(strings.Repeat("x", 262145)))
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
