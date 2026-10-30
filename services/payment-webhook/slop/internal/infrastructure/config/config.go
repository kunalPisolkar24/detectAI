package config

import (
	"fmt"
	"os"
)

type Config struct {
	RabbitMQURL       string
	RabbitMQQueueType string
	WebhookSecret     string
	InternalAPIKey    string
	Port              string
}

func getEnv(key, fallback string) string {
	if value, ok := os.LookupEnv(key); ok {
		return value
	}
	return fallback
}

func Load() (*Config, error) {
	rabbitURL := getEnv("RABBITMQ_URL", "amqp://guest:guest@rabbitmq:5672/")
	queueType := getEnv("RABBITMQ_QUEUE_TYPE", "classic")
	secret := os.Getenv("PADDLE_WEBHOOK_SECRET")
	internalKey := os.Getenv("INTERNAL_API_KEY")

	if secret == "" {
		return nil, fmt.Errorf("PADDLE_WEBHOOK_SECRET is required")
	}
	if internalKey == "" {
		return nil, fmt.Errorf("INTERNAL_API_KEY is required")
	}

	port := getEnv("PORT", "8080")

	return &Config{
		RabbitMQURL:       rabbitURL,
		RabbitMQQueueType: queueType,
		WebhookSecret:     secret,
		InternalAPIKey:    internalKey,
		Port:              port,
	}, nil
}