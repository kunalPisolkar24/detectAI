package rabbitmq

import (
	"context"
	"gateway/internal/logger"
	"gateway/test/mocks"
	"os"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
)

func TestRabbitMQIntegration(t *testing.T) {
	rabbitURL := os.Getenv("TEST_RABBITMQ_URL")
	if rabbitURL == "" {
		t.Skip("Skipping RabbitMQ integration test: TEST_RABBITMQ_URL not set")
	}

	log := logger.New()
	mr := new(mocks.MockMetricsRecorder)
	queueName := "test_queue_" + time.Now().Format("20060102150405")
	
	mr.On("SetRabbitMQStatus", mock.Anything).Return().Maybe()
	mr.On("RecordRabbitMQPublishDuration", mock.Anything).Return().Maybe()

	p := NewRabbitMQProducer(rabbitURL, queueName, "classic", log, mr)
	defer p.Close()

	assert.Eventually(t, func() bool {
		return p.IsConnected()
	}, 10*time.Second, 100*time.Millisecond)

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	err := p.Publish(ctx, []byte("test-payload"))
	assert.NoError(t, err)
}