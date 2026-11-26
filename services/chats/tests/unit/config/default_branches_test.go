package config_test

import (
	"testing"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/config"
)

func TestBlankRateLimitAndServiceNameTakeTheDefaults(t *testing.T) {
	cfg, err := config.Resolve(with(map[string]string{
		"RATE_LIMIT_READ_MAX":   "   ",
		"RATE_LIMIT_CREATE_MAX": "   ",
		"RATE_LIMIT_WRITE_MAX":  "  ",
		"OTEL_SERVICE_NAME":     "   ",
	}))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.RateLimitReadMax != 600 || cfg.RateLimitCreateMax != 10 || cfg.RateLimitWriteMax != 60 {
		t.Errorf("rate limits = %d/%d/%d, want the defaults", cfg.RateLimitReadMax, cfg.RateLimitCreateMax, cfg.RateLimitWriteMax)
	}
	if cfg.OTelName != "chats" {
		t.Errorf("OTelName = %q, want the default service name", cfg.OTelName)
	}
}
