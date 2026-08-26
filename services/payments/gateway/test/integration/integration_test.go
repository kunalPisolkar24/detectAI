//go:build integration

package integration

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"gateway/internal/domain"
	"gateway/internal/infrastructure/paddle"
	"gateway/internal/infrastructure/rabbitmq"
	"gateway/internal/logger"
	"gateway/internal/monitoring"
	transporthttp "gateway/internal/transport/http"

	"github.com/gin-gonic/gin"
	amqp "github.com/rabbitmq/amqp091-go"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	testcontainers "github.com/testcontainers/testcontainers-go"
	containerRabbitmq "github.com/testcontainers/testcontainers-go/modules/rabbitmq"
)

func paddleSignature(secret string, body []byte, ts int64) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(fmt.Sprintf("%d:%s", ts, body)))
	return fmt.Sprintf("ts=%d;h1=%s", ts, hex.EncodeToString(mac.Sum(nil)))
}

func TestGatewayIntegration(t *testing.T) {
	testcontainers.SkipIfProviderIsNotHealthy(t)

	ctx := context.Background()
	log := logger.New()
	monitor := monitoring.New("payment-gateway-test")

	rabbitmqContainer, err := containerRabbitmq.Run(ctx, "rabbitmq:3-management-alpine",
		containerRabbitmq.WithAdminUsername("guest"),
		containerRabbitmq.WithAdminPassword("guest"),
	)
	require.NoError(t, err)

	var terminateOnce sync.Once
	terminate := func() {
		terminateOnce.Do(func() {
			if err := rabbitmqContainer.Terminate(ctx); err != nil {
				t.Logf("failed to terminate rabbitmq container: %s", err)
			}
		})
	}
	t.Cleanup(terminate)

	amqpURL, err := rabbitmqContainer.AmqpURL(ctx)
	require.NoError(t, err)

	queueName := "payment_events"
	webhookSecret := "test_webhook_secret"
	internalKey := "test_internal_key"

	prod := rabbitmq.NewRabbitMQProducer(amqpURL, queueName, "classic", log, monitor)
	defer prod.Close()

	assert.Eventually(t, func() bool {
		return prod.IsConnected()
	}, 15*time.Second, 100*time.Millisecond)

	svc := domain.NewPaymentService(prod, paddle.NewPaddleValidator(), monitor, webhookSecret)
	handler := transporthttp.NewHandler(transporthttp.HandlerConfig{
		Service:     svc,
		Health:      prod,
		Metrics:     monitor,
		InternalKey: internalKey,
		Logger:      log,
	})

	router := gin.New()
	handler.RegisterRoutes(router)

	postJSON := func(path string, headers map[string]string, body []byte) *httptest.ResponseRecorder {
		req, err := http.NewRequest(http.MethodPost, path, bytes.NewBuffer(body))
		require.NoError(t, err)
		req.Header.Set("Content-Type", "application/json")
		for k, v := range headers {
			req.Header.Set(k, v)
		}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		return w
	}

	tryConsume := func(timeout time.Duration) ([]byte, bool) {
		conn, err := amqp.Dial(amqpURL)
		if err != nil {
			return nil, false
		}
		defer conn.Close()

		ch, err := conn.Channel()
		if err != nil {
			return nil, false
		}
		defer ch.Close()

		msgs, err := ch.Consume(queueName, "", true, false, false, false, nil)
		if err != nil {
			return nil, false
		}

		select {
		case d := <-msgs:
			return d.Body, true
		case <-time.After(timeout):
			return nil, false
		}
	}

	t.Run("Internal event to queue", func(t *testing.T) {
		event := map[string]interface{}{
			"event_type": "user.cancel_subscription",
			"data": map[string]string{
				"userId":               "user-123",
				"paddleSubscriptionId": "sub-456",
			},
		}
		body, err := json.Marshal(event)
		require.NoError(t, err)

		w := postJSON("/internal/events", map[string]string{"X-Internal-Key": internalKey}, body)
		assert.Equal(t, http.StatusOK, w.Code)

		consumed, ok := tryConsume(5 * time.Second)
		require.True(t, ok, "expected message in queue")

		var got map[string]interface{}
		require.NoError(t, json.Unmarshal(consumed, &got))
		assert.Equal(t, event["event_type"], got["event_type"])
	})

	t.Run("Signed webhook to queue with unchanged body", func(t *testing.T) {
		body := []byte(`{"event_type":"subscription.updated","data":{"id":"sub_123","status":"active"}}`)
		sig := paddleSignature(webhookSecret, body, time.Now().Unix())

		w := postJSON("/webhook/paddle", map[string]string{"Paddle-Signature": sig}, body)
		assert.Equal(t, http.StatusOK, w.Code)

		consumed, ok := tryConsume(5 * time.Second)
		require.True(t, ok, "expected message in queue")
		assert.Equal(t, body, consumed, "queued body must be byte-for-byte identical")
	})

	t.Run("Legacy alert_name preserved end-to-end", func(t *testing.T) {
		body := []byte(`{"alert_name":"payment.succeeded","custom_data":{"order_id":"ord_1"}}`)
		sig := paddleSignature(webhookSecret, body, time.Now().Unix())

		w := postJSON("/webhook/paddle", map[string]string{"Paddle-Signature": sig}, body)
		assert.Equal(t, http.StatusOK, w.Code)

		consumed, ok := tryConsume(5 * time.Second)
		require.True(t, ok, "expected message in queue")

		var got map[string]interface{}
		require.NoError(t, json.Unmarshal(consumed, &got))
		assert.Equal(t, "payment.succeeded", got["alert_name"])
	})

	t.Run("Forged signature queues nothing", func(t *testing.T) {
		body := []byte(`{"event_type":"subscription.updated"}`)
		sig := paddleSignature("wrong-secret", body, time.Now().Unix())

		w := postJSON("/webhook/paddle", map[string]string{"Paddle-Signature": sig}, body)
		assert.Equal(t, http.StatusUnauthorized, w.Code)

		_, queued := tryConsume(1500 * time.Millisecond)
		assert.False(t, queued, "nothing must be queued for a forged signature")
	})

	t.Run("Wrong internal key queues nothing", func(t *testing.T) {
		body := []byte(`{"event_type":"user.cancel_subscription"}`)

		w := postJSON("/internal/events", map[string]string{"X-Internal-Key": "not-the-key"}, body)
		assert.Equal(t, http.StatusUnauthorized, w.Code)

		_, queued := tryConsume(1500 * time.Millisecond)
		assert.False(t, queued, "nothing must be queued for a wrong internal key")
	})

	t.Run("Readiness returns 503 after broker termination", func(t *testing.T) {
		require.NoError(t, rabbitmqContainer.Terminate(ctx))
		terminate()

		assert.Eventually(t, func() bool {
			return !prod.IsConnected()
		}, 30*time.Second, 500*time.Millisecond)

		req, err := http.NewRequest(http.MethodGet, "/readyz", nil)
		require.NoError(t, err)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		assert.Equal(t, http.StatusServiceUnavailable, w.Code)
	})
}
