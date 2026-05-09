package rabbitmq

import (
	"context"
	"gateway/internal/logger"
	"os"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func TestRabbitMQIntegration(t *testing.T) {
	rabbitURL := os.Getenv("TEST_RABBITMQ_URL")
	if rabbitURL == "" {
		t.Skip("Skipping RabbitMQ integration test: TEST_RABBITMQ_URL not set")
	}

	log := logger.New()
	queueName := "test_queue_" + time.Now().Format("20060102150405")
	
	p := NewRabbitMQProducer(rabbitURL, queueName, "classic", log)
	defer p.Close()

	assert.True(t, p.IsConnected())

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	err := p.Publish(ctx, []byte("test-payload"))
	assert.NoError(t, err)
}