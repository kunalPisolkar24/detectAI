package config

import (
	"testing"
)

func validConfig() *Config {
	return &Config{
		RabbitMQURL:       "amqp://guest:guest@rabbitmq:5672/",
		RabbitMQQueueType: "quorum",
		WebhookSecret:     "test_webhook_secret_16chars",
		InternalAPIKey:    "test_internal_key_16chars",
		Port:              "8080",
		GinMode:           "release",
		EnvType:           "dev",
	}
}

func TestValidateOtelEndpoint(t *testing.T) {
	cfg := validConfig()
	if err := cfg.Validate(); err != nil {
		t.Fatalf("empty endpoint must be valid: %v", err)
	}

	cfg.OtelEndpoint = "http://otel-collector-loadtest:4318"
	if err := cfg.Validate(); err != nil {
		t.Fatalf("http endpoint must be valid: %v", err)
	}

	for _, bad := range []string{"otel-collector:4318", "ftp://otel:4318", "http://", "://missing-scheme"} {
		cfg.OtelEndpoint = bad
		if err := cfg.Validate(); err == nil {
			t.Fatalf("endpoint %q must be rejected", bad)
		}
	}
}

func TestOtelServiceVersionDefault(t *testing.T) {
	t.Setenv("OTEL_SERVICE_VERSION", "")
	t.Setenv("SERVICE_VERSION", "")
	if got := otelServiceVersion(); got != "dev" {
		t.Fatalf("default version must be dev, got %q", got)
	}

	t.Setenv("SERVICE_VERSION", "1.2.3")
	if got := otelServiceVersion(); got != "1.2.3" {
		t.Fatalf("SERVICE_VERSION fallback broken, got %q", got)
	}

	t.Setenv("OTEL_SERVICE_VERSION", "2.0.0")
	if got := otelServiceVersion(); got != "2.0.0" {
		t.Fatalf("OTEL_SERVICE_VERSION must win, got %q", got)
	}
}
