package config

import (
	"os"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestLoad(t *testing.T) {
	origPort := os.Getenv("PORT")
	defer func() { os.Setenv("PORT", origPort) }()

	t.Run("Fails if missing required", func(t *testing.T) {
		os.Clearenv()
		cfg, err := Load()
		assert.Error(t, err)
		assert.Nil(t, cfg)
	})

	t.Run("Success with overrides", func(t *testing.T) {
		os.Clearenv()
		os.Setenv("PORT", "9090")
		os.Setenv("PADDLE_WEBHOOK_SECRET", "supersecret")
		os.Setenv("INTERNAL_API_KEY", "internalsecret")
		
		cfg, err := Load()
		assert.NoError(t, err)
		assert.Equal(t, "9090", cfg.Port)
		assert.Equal(t, "supersecret", cfg.WebhookSecret)
		assert.Equal(t, "internalsecret", cfg.InternalAPIKey)
	})
}