package config_test

import (
	"strings"
	"testing"
	"time"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/config"
)

func TestResolveLockTTL(t *testing.T) {
	t.Run("an unset or blank budget takes the default", func(t *testing.T) {
		for _, value := range []string{"", "   "} {
			cfg, err := config.Resolve(with(map[string]string{"LOCK_TTL": value}))
			if err != nil {
				t.Fatal(err)
			}
			if cfg.LockTTL != 10*time.Second {
				t.Errorf("LockTTL = %v, want %v", cfg.LockTTL, 10*time.Second)
			}
		}
	})

	t.Run("a set budget wins", func(t *testing.T) {
		cfg, err := config.Resolve(with(map[string]string{"LOCK_TTL": "30s"}))
		if err != nil {
			t.Fatal(err)
		}
		if cfg.LockTTL != 30*time.Second {
			t.Errorf("LockTTL = %v, want %v", cfg.LockTTL, 30*time.Second)
		}
	})

	t.Run("a budget too short for a source read fails the boot", func(t *testing.T) {
		for _, tc := range []struct {
			value   string
			wantErr string
		}{
			{"5s", "LOCK_TTL must exceed"},
			{"0s", "LOCK_TTL must be a positive duration"},
			{"soon", "LOCK_TTL must be a positive duration"},
		} {
			_, err := config.Resolve(with(map[string]string{"LOCK_TTL": tc.value}))
			if err == nil || !strings.Contains(err.Error(), tc.wantErr) {
				t.Errorf("LOCK_TTL=%q: err = %v, want it to contain %q", tc.value, err, tc.wantErr)
			}
		}
	})
}
