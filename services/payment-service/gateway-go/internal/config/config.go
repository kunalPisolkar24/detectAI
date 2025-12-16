package config

import "os"

type Config struct {
	RabbitMQURL   string
	WebhookSecret string
	Port          string
}

func Load() *Config {
	rabbitURL := os.Getenv("RABBITMQ_URL")
	if rabbitURL == "" {
		rabbitURL = "amqp://guest:guest@rabbitmq:5672/"
	}

	secret := os.Getenv("PADDLE_WEBHOOK_SECRET")

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	return &Config{
		RabbitMQURL:   rabbitURL,
		WebhookSecret: secret,
		Port:          port,
	}
}