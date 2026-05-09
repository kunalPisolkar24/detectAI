package config

import (
	"fmt"
	"os"
)

type Config struct {
	RabbitMQURL    string
	WebhookSecret  string
	InternalAPIKey string
	Port           string
}

func Load() (*Config, error) {
	rabbitURL := os.Getenv("RABBITMQ_URL")
	if rabbitURL == "" {
		rabbitURL = "amqp://guest:guest@rabbitmq:5672/"
	}

	secret := os.Getenv("PADDLE_WEBHOOK_SECRET")
	if secret == "" {
		return nil, fmt.Errorf("PADDLE_WEBHOOK_SECRET is required")
	}

	internalKey := os.Getenv("INTERNAL_API_KEY")
	if internalKey == "" {
		return nil, fmt.Errorf("INTERNAL_API_KEY is required")
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	return &Config{
		RabbitMQURL:    rabbitURL,
		WebhookSecret:  secret,
		InternalAPIKey: internalKey,
		Port:           port,
	}, nil
}