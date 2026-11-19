package config_test

import (
	"strings"
	"testing"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/config"
)

func TestResolveRateLimits(t *testing.T) {
	t.Run("an unset budget takes the conservative default", func(t *testing.T) {
		cfg, err := config.Resolve(with(nil))
		if err != nil {
			t.Fatal(err)
		}
		if cfg.RateLimitCreateMax != 10 {
			t.Errorf("RateLimitCreateMax = %d, want %d", cfg.RateLimitCreateMax, 10)
		}
		if cfg.RateLimitWriteMax != 60 {
			t.Errorf("RateLimitWriteMax = %d, want %d", cfg.RateLimitWriteMax, 60)
		}
	})

	t.Run("a set budget wins", func(t *testing.T) {
		cfg, err := config.Resolve(with(map[string]string{
			"RATE_LIMIT_CREATE_MAX": "3",
			"RATE_LIMIT_WRITE_MAX":  "12",
		}))
		if err != nil {
			t.Fatal(err)
		}
		if cfg.RateLimitCreateMax != 3 {
			t.Errorf("RateLimitCreateMax = %d, want %d", cfg.RateLimitCreateMax, 3)
		}
		if cfg.RateLimitWriteMax != 12 {
			t.Errorf("RateLimitWriteMax = %d, want %d", cfg.RateLimitWriteMax, 12)
		}
	})

	t.Run("a malformed budget fails the boot", func(t *testing.T) {
		for name, tc := range map[string]struct {
			key     string
			value   string
			wantErr string
		}{
			"create is not a number": {key: "RATE_LIMIT_CREATE_MAX", value: "many", wantErr: "RATE_LIMIT_CREATE_MAX must be a positive integer"},
			"write is not a number":  {key: "RATE_LIMIT_WRITE_MAX", value: "12.5", wantErr: "RATE_LIMIT_WRITE_MAX must be a positive integer"},
			"create is zero":         {key: "RATE_LIMIT_CREATE_MAX", value: "0", wantErr: "RATE_LIMIT_CREATE_MAX must be a positive integer"},
			"write is negative":      {key: "RATE_LIMIT_WRITE_MAX", value: "-1", wantErr: "RATE_LIMIT_WRITE_MAX must be a positive integer"},
		} {
			t.Run(name, func(t *testing.T) {
				_, err := config.Resolve(with(map[string]string{tc.key: tc.value}))
				if err == nil || !strings.Contains(err.Error(), tc.wantErr) {
					t.Errorf("err = %v, want it to contain %q", err, tc.wantErr)
				}
			})
		}
	})
}
