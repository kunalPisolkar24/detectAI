//go:build integration
package integration

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"gateway/internal/domain"
	"gateway/internal/logger"
	"gateway/internal/infrastructure/rabbitmq"
	transporthttp "gateway/internal/transport/http"
	"gateway/internal/infrastructure/paddle"
	"gateway/internal/monitoring"

	"github.com/gin-gonic/gin"
	amqp "github.com/rabbitmq/amqp091-go"
	"github.com/stretchr/testify/assert"
	containerRabbitmq "github.com/testcontainers/testcontainers-go/modules/rabbitmq"
)

func TestGatewayIntegration(t *testing.T) {
	ctx := context.Background()
	log := logger.New()
	monitor := monitoring.New("payment-gateway-test")

	// 1. Start RabbitMQ Container
	rabbitmqContainer, err := containerRabbitmq.Run(ctx, "rabbitmq:3-management-alpine",
		containerRabbitmq.WithAdminUsername("guest"),
		containerRabbitmq.WithAdminPassword("guest"),
	)
	if err != nil {
		t.Fatalf("failed to start rabbitmq container: %s", err)
	}
	defer func() {
		if err := rabbitmqContainer.Terminate(ctx); err != nil {
			t.Fatalf("failed to terminate rabbitmq container: %s", err)
		}
	}()

	amqpURL, err := rabbitmqContainer.AmqpURL(ctx)
	if err != nil {
		t.Fatalf("failed to get amqp url: %s", err)
	}

	// 2. Setup Gateway Components
	queueName := "payment_events"
	webhookSecret := "test_webhook_secret"
	internalKey := "test_internal_key"

	prod := rabbitmq.NewRabbitMQProducer(amqpURL, queueName, "classic", log, monitor)
	defer prod.Close()

	// Wait for producer to connect and setup topology
	assert.Eventually(t, func() bool {
		return prod.IsConnected()
	}, 10*time.Second, 100*time.Millisecond)

	val := paddle.NewPaddleValidator()
	svc := domain.NewPaymentService(prod, val, monitor, webhookSecret)
	
	handler := transporthttp.NewHandler(transporthttp.HandlerConfig{
		Service:     svc,
		Health:      prod,
		InternalKey: internalKey,
		Logger:      log,
	})

	router := gin.New()
	handler.RegisterRoutes(router)

	t.Run("End-to-End: Internal Event to Queue", func(t *testing.T) {
		event := map[string]interface{}{
			"event_type": "user.cancel_subscription",
			"data": map[string]string{
				"userId":               "user-123",
				"paddleSubscriptionId": "sub-456",
			},
		}
		body, _ := json.Marshal(event)

		// Send request to internal endpoint
		w := httptest.NewRecorder()
		req, _ := http.NewRequest("POST", "/internal/events", bytes.NewBuffer(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Internal-Key", internalKey)
		router.ServeHTTP(w, req)

		assert.Equal(t, http.StatusOK, w.Code)

		// Verify message in RabbitMQ
		conn, err := amqp.Dial(amqpURL)
		assert.NoError(t, err)
		defer conn.Close()

		ch, err := conn.Channel()
		assert.NoError(t, err)
		defer ch.Close()

		// Consume the message
		msgs, err := ch.Consume(queueName, "", true, false, false, false, nil)
		assert.NoError(t, err)

		select {
		case d := <-msgs:
			var consumedEvent map[string]interface{}
			err := json.Unmarshal(d.Body, &consumedEvent)
			assert.NoError(t, err)
			assert.Equal(t, event["event_type"], consumedEvent["event_type"])
		case <-time.After(5 * time.Second):
			t.Fatal("Timeout waiting for message in queue")
		}
	})

}
