package handlers_test

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
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
	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/validator"
)

const testSecret = "change-me-min-16-chars"

// max is shrunk from the 1 MiB default so an oversize body is a cheap test
// literal instead of a megabyte allocation.
const max = int64(1024)

// The handler matrix exercises the real validator (design.md: fakes return
// with the publisher build), so the reference clock is time.Now and the valid
// vectors sit inside the freshness window by whole seconds.
func newHandler() gin.HandlerFunc {
	gin.SetMode(gin.TestMode)
	return handlers.NewPaddleWebhook(validator.NewPaddle(testSecret), max)
}

// serve runs the mounted handler over a fresh test context wired to w.
func serve(t *testing.T, w *httptest.ResponseRecorder, req *http.Request) {
	t.Helper()
	c, _ := gin.CreateTestContext(w)
	c.Request = req
	newHandler()(c)
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

func post(t *testing.T, body []byte, header string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/webhook/paddle", bytesOfReader(body))
	if header != "" {
		req.Header.Set("Paddle-Signature", header)
	}
	w := httptest.NewRecorder()
	serve(t, w, req)
	return w
}

func TestPaddleWebhookQueuesValidEvents(t *testing.T) {
	for name, body := range map[string][]byte{
		"small body":        []byte(`{"event_type":"subscription.updated"}`),
		"exactly the bound": bytesOf(max), // max is legal; max+1 is not
	} {
		t.Run(name, func(t *testing.T) {
			w := post(t, body, sign(testSecret, freshTS(t), body))
			if w.Code != http.StatusOK {
				t.Errorf("status = %d, want 200", w.Code)
			}
			if body := w.Body.String(); body != `{"status":"queued"}` {
				t.Errorf("body = %q, want the queued envelope", body)
			}
		})
	}
}

func TestPaddleWebhookRejectsBadSignaturesIdentically(t *testing.T) {
	body := []byte(`{"event_type":"subscription.updated"}`)
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
			w := post(t, body, header)
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
	w := post(t, bytesOf(max+1), "garbage")
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
	serve(t, w, req)
	if w.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", w.Code)
	}
	if body := w.Body.String(); body != `{"error":"request body is unreadable"}` {
		t.Errorf("body = %q, want the unreadable envelope", body)
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
