package http

import (
	"bytes"
	"errors"
	"gateway/internal/logger"
	"gateway/internal/monitoring"
	"gateway/test/mocks"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
)

func setupTestRouter(ms *mocks.MockPaymentService, mh *mocks.MockEventProducer) *gin.Engine {
	gin.SetMode(gin.TestMode)
	log := logger.New()
	monitor := monitoring.New("payment-gateway")
	handler := NewHandler(HandlerConfig{
		Service:     ms,
		Health:      mh,
		Metrics:     monitor,
		InternalKey: "internal-secret",
		Logger:      log,
	})
	r := gin.New()
	r.Use(monitor.Middleware())
	r.GET("/metrics", gin.WrapH(monitor.Handler()))
	handler.RegisterRoutes(r)
	return r
}

func TestHandler_Livez(t *testing.T) {
	ms := new(mocks.MockPaymentService)
	mh := new(mocks.MockEventProducer)
	router := setupTestRouter(ms, mh)

	t.Run("Returns 200 even when RabbitMQ is disconnected", func(t *testing.T) {
		w := httptest.NewRecorder()
		req, _ := http.NewRequest("GET", "/healthz", nil)
		router.ServeHTTP(w, req)

		assert.Equal(t, http.StatusOK, w.Code)
	})
}

func TestHandler_Readyz(t *testing.T) {
	ms := new(mocks.MockPaymentService)
	mh := new(mocks.MockEventProducer)
	router := setupTestRouter(ms, mh)

	t.Run("Returns 200 when connected", func(t *testing.T) {
		mh.On("IsConnected").Return(true).Once()

		w := httptest.NewRecorder()
		req, _ := http.NewRequest("GET", "/readyz", nil)
		router.ServeHTTP(w, req)

		assert.Equal(t, http.StatusOK, w.Code)
	})

	t.Run("Returns 503 when disconnected", func(t *testing.T) {
		mh.On("IsConnected").Return(false).Once()

		w := httptest.NewRecorder()
		req, _ := http.NewRequest("GET", "/readyz", nil)
		router.ServeHTTP(w, req)

		assert.Equal(t, http.StatusServiceUnavailable, w.Code)
	})
}

func TestHandler_HandleWebhook(t *testing.T) {
	ms := new(mocks.MockPaymentService)
	mh := new(mocks.MockEventProducer)
	router := setupTestRouter(ms, mh)

	body := []byte(`{"alert":"payment_succeeded"}`)
	signature := "valid-signature"

	t.Run("Success", func(t *testing.T) {
		ms.On("ProcessWebhook", mock.Anything, signature, body).Return(nil).Once()

		w := httptest.NewRecorder()
		req, _ := http.NewRequest("POST", "/webhook/paddle", bytes.NewBuffer(body))
		req.Header.Set("Paddle-Signature", signature)
		router.ServeHTTP(w, req)

		assert.Equal(t, http.StatusOK, w.Code)
	})

	t.Run("Invalid Signature Error", func(t *testing.T) {
		ms.On("ProcessWebhook", mock.Anything, signature, body).Return(errors.New("invalid signature")).Once()

		w := httptest.NewRecorder()
		req, _ := http.NewRequest("POST", "/webhook/paddle", bytes.NewBuffer(body))
		req.Header.Set("Paddle-Signature", signature)
		router.ServeHTTP(w, req)

		assert.Equal(t, http.StatusUnauthorized, w.Code)
	})

	t.Run("Internal Error", func(t *testing.T) {
		ms.On("ProcessWebhook", mock.Anything, signature, body).Return(errors.New("some error")).Once()

		w := httptest.NewRecorder()
		req, _ := http.NewRequest("POST", "/webhook/paddle", bytes.NewBuffer(body))
		req.Header.Set("Paddle-Signature", signature)
		router.ServeHTTP(w, req)

		assert.Equal(t, http.StatusInternalServerError, w.Code)
	})

	t.Run("Body Too Large", func(t *testing.T) {
		oversized := bytes.Repeat([]byte("a"), (1<<20)+1)

		w := httptest.NewRecorder()
		req, _ := http.NewRequest("POST", "/webhook/paddle", bytes.NewBuffer(oversized))
		req.Header.Set("Paddle-Signature", signature)
		router.ServeHTTP(w, req)

		assert.Equal(t, http.StatusBadRequest, w.Code)
	})
}

func TestHandler_HandleInternalEvent(t *testing.T) {
	ms := new(mocks.MockPaymentService)
	mh := new(mocks.MockEventProducer)
	router := setupTestRouter(ms, mh)

	body := []byte(`{"event":"internal"}`)

	t.Run("Success", func(t *testing.T) {
		ms.On("ProcessInternalEvent", mock.Anything, body).Return(nil).Once()

		w := httptest.NewRecorder()
		req, _ := http.NewRequest("POST", "/internal/events", bytes.NewBuffer(body))
		req.Header.Set("X-Internal-Key", "internal-secret")

		router.ServeHTTP(w, req)

		assert.Equal(t, http.StatusOK, w.Code)
	})

	t.Run("Unauthorized", func(t *testing.T) {
		w := httptest.NewRecorder()
		req, _ := http.NewRequest("POST", "/internal/events", bytes.NewBuffer(body))
		req.Header.Set("X-Internal-Key", "wrong-key")

		router.ServeHTTP(w, req)

		assert.Equal(t, http.StatusUnauthorized, w.Code)
	})
}

func TestHandler_Metrics(t *testing.T) {
	ms := new(mocks.MockPaymentService)
	mh := new(mocks.MockEventProducer)
	router := setupTestRouter(ms, mh)

	mh.On("IsConnected").Return(true).Once()

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/metrics", nil)
	router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}
