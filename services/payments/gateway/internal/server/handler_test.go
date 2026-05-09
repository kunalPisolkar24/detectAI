package server

import (
	"bytes"
	"errors"
	"gateway/internal/domain"
	"gateway/internal/logger"
	"gateway/internal/mocks"
	"gateway/internal/monitoring"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
)

func setupTestRouter(mp *mocks.MockEventProducer, mv *mocks.MockSignatureValidator) *gin.Engine {
	gin.SetMode(gin.TestMode)
	log := logger.New()
	service := domain.NewPaymentService(mp, mv, "test-secret")
	handler := NewHandler(HandlerConfig{
		Service:     service,
		Health:      mp,
		InternalKey: "internal-secret",
		Logger:      log,
	})
	monitor := monitoring.New("payment-gateway")
	r := gin.New()
	r.Use(monitor.Middleware())
	r.GET("/metrics", gin.WrapH(monitor.Handler()))
	handler.RegisterRoutes(r)
	return r
}

func TestHandler_HealthCheck(t *testing.T) {
	mp := new(mocks.MockEventProducer)
	mv := new(mocks.MockSignatureValidator)
	router := setupTestRouter(mp, mv)

	t.Run("Returns 200 when RabbitMQ is connected", func(t *testing.T) {
		mp.On("IsConnected").Return(true).Once()

		w := httptest.NewRecorder()
		req, _ := http.NewRequest("GET", "/health", nil)
		router.ServeHTTP(w, req)

		assert.Equal(t, http.StatusOK, w.Code)
	})

	t.Run("Returns 503 when RabbitMQ is disconnected", func(t *testing.T) {
		mp.On("IsConnected").Return(false).Once()

		w := httptest.NewRecorder()
		req, _ := http.NewRequest("GET", "/health", nil)
		router.ServeHTTP(w, req)

		assert.Equal(t, http.StatusServiceUnavailable, w.Code)
	})
}

func TestHandler_HandleWebhook(t *testing.T) {
	mp := new(mocks.MockEventProducer)
	mv := new(mocks.MockSignatureValidator)
	router := setupTestRouter(mp, mv)

	body := []byte(`{"alert":"payment_succeeded"}`)
	signature := "valid-signature"

	t.Run("Success flow", func(t *testing.T) {
		mv.On("Validate", signature, body, "test-secret").Return(true).Once()
		mp.On("Publish", mock.Anything, body).Return(nil).Once()

		w := httptest.NewRecorder()
		req, _ := http.NewRequest("POST", "/webhook/paddle", bytes.NewBuffer(body))
		req.Header.Set("Paddle-Signature", signature)
		router.ServeHTTP(w, req)

		assert.Equal(t, http.StatusOK, w.Code)
		mp.AssertExpectations(t)
		mv.AssertExpectations(t)
	})

	t.Run("Invalid Signature", func(t *testing.T) {
		mv.On("Validate", signature, body, "test-secret").Return(false).Once()

		w := httptest.NewRecorder()
		req, _ := http.NewRequest("POST", "/webhook/paddle", bytes.NewBuffer(body))
		req.Header.Set("Paddle-Signature", signature)
		router.ServeHTTP(w, req)

		assert.Equal(t, http.StatusUnauthorized, w.Code)
		mp.AssertNotCalled(t, "Publish")
	})

	t.Run("Queue Error", func(t *testing.T) {
		mv.On("Validate", signature, body, "test-secret").Return(true).Once()
		mp.On("Publish", mock.Anything, body).Return(errors.New("connection broken")).Once()

		w := httptest.NewRecorder()
		req, _ := http.NewRequest("POST", "/webhook/paddle", bytes.NewBuffer(body))
		req.Header.Set("Paddle-Signature", signature)
		router.ServeHTTP(w, req)

		assert.Equal(t, http.StatusInternalServerError, w.Code)
	})
}

func TestHandler_HandleInternalEvent(t *testing.T) {
	mp := new(mocks.MockEventProducer)
	mv := new(mocks.MockSignatureValidator)
	router := setupTestRouter(mp, mv)

	body := []byte(`{"event_type":"user_signup", "user_id": 99}`)

	t.Run("Success flow", func(t *testing.T) {
		mp.On("Publish", mock.Anything, body).Return(nil).Once()

		w := httptest.NewRecorder()
		req, _ := http.NewRequest("POST", "/internal/events", bytes.NewBuffer(body))
		req.Header.Set("X-Internal-Key", "internal-secret")

		router.ServeHTTP(w, req)

		assert.Equal(t, http.StatusOK, w.Code)
		mp.AssertExpectations(t)
	})

	t.Run("Unauthorized", func(t *testing.T) {
		w := httptest.NewRecorder()
		req, _ := http.NewRequest("POST", "/internal/events", bytes.NewBuffer(body))
		req.Header.Set("X-Internal-Key", "wrong-key")

		router.ServeHTTP(w, req)

		assert.Equal(t, http.StatusUnauthorized, w.Code)
	})

	t.Run("Queue Error", func(t *testing.T) {
		mp.On("Publish", mock.Anything, body).Return(errors.New("queue full")).Once()

		w := httptest.NewRecorder()
		req, _ := http.NewRequest("POST", "/internal/events", bytes.NewBuffer(body))
		req.Header.Set("X-Internal-Key", "internal-secret")

		router.ServeHTTP(w, req)

		assert.Equal(t, http.StatusInternalServerError, w.Code)
		mp.AssertExpectations(t)
	})
}

func TestHandler_Metrics(t *testing.T) {
	mp := new(mocks.MockEventProducer)
	mv := new(mocks.MockSignatureValidator)
	router := setupTestRouter(mp, mv)

	mp.On("IsConnected").Return(true).Once()

	healthRecorder := httptest.NewRecorder()
	healthRequest, _ := http.NewRequest("GET", "/health", nil)
	router.ServeHTTP(healthRecorder, healthRequest)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/metrics", nil)
	router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), "http_requests_total")
	assert.Contains(t, w.Body.String(), "http_request_duration_seconds")
}
