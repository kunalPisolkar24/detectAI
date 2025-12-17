package config

import (
	"os"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestLoad(t *testing.T) {
	origPort := os.Getenv("PORT")
	defer func() { os.Setenv("PORT", origPort) }()

	t.Run("Defaults", func(t *testing.T) {
		os.Clearenv()
		cfg := Load()
		assert.Equal(t, "8080", cfg.Port)
		assert.Contains(t, cfg.RabbitMQURL, "amqp://")
	})

	t.Run("Env Overrides", func(t *testing.T) {
		os.Setenv("PORT", "9090")
		os.Setenv("PADDLE_WEBHOOK_SECRET", "supersecret")
		
		cfg := Load()
		assert.Equal(t, "9090", cfg.Port)
		assert.Equal(t, "supersecret", cfg.WebhookSecret)
	})
}