package router_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"

	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/config"
	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/router"
)

const sharedKey = "change-me-min-16-chars"

func newEngine(t *testing.T) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	return router.New(config.Config{APIKey: sharedKey})
}

func postInternal(t *testing.T, key string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/internal/events", nil)
	if key != "" {
		req.Header.Set("x-api-key", key)
	}
	w := httptest.NewRecorder()
	newEngine(t).ServeHTTP(w, req)
	return w
}

func TestInternalEventRejectsMissingAndForeignKeysIdentically(t *testing.T) {
	rejections := map[string]string{}
	for name, key := range map[string]string{"missing": "", "foreign": "another-secret-16-key"} {
		t.Run(name, func(t *testing.T) {
			w := postInternal(t, key)
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
}

func TestInternalEventServesWithTheSharedKey(t *testing.T) {
	w := postInternal(t, sharedKey)
	if w.Code != http.StatusOK {
		t.Errorf("status = %d, want 200", w.Code)
	}
	if body := w.Body.String(); body != `{"status":"queued"}` {
		t.Errorf("body = %q, want the static queued envelope", body)
	}
}

func TestPaddleFaceCarriesNoAPIKeyGuard(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/api/v1/webhook/paddle", nil)
	w := httptest.NewRecorder()
	newEngine(t).ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("status = %d, want 200; the paddle face owns signature validation later, no API key guard",
			w.Code)
	}
}
