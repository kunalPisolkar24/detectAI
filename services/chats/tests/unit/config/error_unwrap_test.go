package config_test

import (
	"errors"
	"testing"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/config"
)

func TestConfigErrorUnwrapsToTheUnderlyingFailure(t *testing.T) {
	t.Setenv("ENV_TYPE", "qa")
	t.Chdir(t.TempDir())

	_, err := config.Load()
	var cfgErr *config.ConfigError
	if !errors.As(err, &cfgErr) {
		t.Fatalf("Load error = %v, want *ConfigError", err)
	}
	cause := errors.Unwrap(cfgErr)
	if cause == nil || cause.Error() != cfgErr.Error() {
		t.Errorf("Unwrap = %v, want the wrapped cause with the same message", cause)
	}
}
