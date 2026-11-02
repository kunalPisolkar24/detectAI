package config_test

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/config"
)

const testAPIKey = "change-me-min-16-chars"
const testPaddleSecret = "paddle-change-me-16-chars"

// mapSource stands in for a plane source over plain key/value entries.
type mapSource map[string]string

func (m mapSource) Get(key string) (string, bool) {
	value, ok := m[key]
	return value, ok
}

// withkey merges the mandatory credentials over extra so each field contract
// case carries one failure point.
func withkey(extra map[string]string) mapSource {
	source := mapSource{"API_KEY": testAPIKey, "PADDLE_WEBHOOK_SECRET": testPaddleSecret}
	for key, value := range extra {
		source[key] = value
	}
	return source
}

func TestDeploymentFlick(t *testing.T) {
	for name, tc := range map[string]struct {
		value   string
		wantErr string
		wantOwn string
	}{
		"unset fails":      {wantErr: "ENV_TYPE is unset"},
		"empty fails":      {value: "", wantErr: "ENV_TYPE is unset"},
		"wrong case fails": {value: "DEV", wantErr: `ENV_TYPE "DEV" is not a flick`},
		"unknown fails":    {value: "qa", wantErr: `ENV_TYPE "qa" is not a flick`},
		"dev serves":       {value: "dev", wantOwn: "dev"},
		"prod serves":      {value: "prod", wantOwn: "prod"},
	} {
		t.Run(name, func(t *testing.T) {
			t.Setenv("ENV_TYPE", tc.value)
			flick, err := config.DeploymentFlick()
			if tc.wantOwn != "" {
				if err != nil || flick != tc.wantOwn {
					t.Fatalf("DeploymentFlick = %q, %v; want %q", flick, err, tc.wantOwn)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), tc.wantErr) {
				t.Errorf("err = %v, want it to contain %q", err, tc.wantErr)
			}
		})
	}
}

func TestResolveContracts(t *testing.T) {
	t.Run("source with only the keys keeps defaults", func(t *testing.T) {
		cfg, err := config.Resolve(withkey(nil))
		if err != nil {
			t.Fatal(err)
		}
		if cfg.Port != 8080 {
			t.Errorf("Port = %d, want the identity default 8080", cfg.Port)
		}
		if cfg.DrainTimeout != 10*time.Second {
			t.Errorf("DrainTimeout = %v, want the budget default 10s", cfg.DrainTimeout)
		}
		if cfg.APIKey != testAPIKey {
			t.Errorf("APIKey = %q, want the plane value", cfg.APIKey)
		}
		if cfg.PaddleSecret != testPaddleSecret {
			t.Errorf("PaddleSecret = %q, want the plane value", cfg.PaddleSecret)
		}
		if cfg.MaxBodyBytes != 1<<20 {
			t.Errorf("MaxBodyBytes = %d, want the 1 MiB default", cfg.MaxBodyBytes)
		}
	})

	for caseName, bad := range map[string]string{
		"garbage":     "eight",
		"blank":       "",
		"zero":        "0",
		"negative":    "-1",
		"over 65535":  "65536",
		"spaced zero": "   0 ",
	} {
		t.Run("PORT "+caseName+" fails naming the var", func(t *testing.T) {
			_, err := config.Resolve(withkey(map[string]string{"PORT": bad}))
			if err == nil || !strings.Contains(err.Error(), "PORT must be an integer between 1 and 65535") {
				t.Errorf("err = %v, want the PORT identity failure", err)
			}
		})
	}

	t.Run("PORT within bounds serves", func(t *testing.T) {
		cfg, err := config.Resolve(withkey(map[string]string{"PORT": "9137"}))
		if err != nil {
			t.Fatal(err)
		}
		if cfg.Port != 9137 {
			t.Errorf("Port = %d, want 9137", cfg.Port)
		}
	})

	for caseName, bad := range map[string]string{
		"blank":    "",
		"garbage":  "junks",
		"zero":     "0s",
		"negative": "-5s",
	} {
		t.Run("DRAIN_TIMEOUT "+caseName+" fail-closes", func(t *testing.T) {
			cfg, err := config.Resolve(withkey(map[string]string{"DRAIN_TIMEOUT": bad}))
			if err != nil {
				t.Fatal(err)
			}
			if cfg.DrainTimeout != 10*time.Second {
				t.Errorf("DrainTimeout = %v, want the 10s fail-closed default", cfg.DrainTimeout)
			}
		})
	}

	t.Run("DRAIN_TIMEOUT valid serves", func(t *testing.T) {
		cfg, err := config.Resolve(withkey(map[string]string{"DRAIN_TIMEOUT": "250ms"}))
		if err != nil {
			t.Fatal(err)
		}
		if cfg.DrainTimeout != 250*time.Millisecond {
			t.Errorf("DrainTimeout = %v, want 250ms", cfg.DrainTimeout)
		}
	})

	// Each mandatory credential is dropped or blanked one at a time: the other
	// stays valid, so the failure always points at exactly one var.
	for _, key := range []string{"API_KEY", "PADDLE_WEBHOOK_SECRET"} {
		for caseName, bad := range map[string]string{
			"missing": "",
			"blank":   "   ",
		} {
			t.Run(key+" "+caseName+" fails without echo", func(t *testing.T) {
				source := withkey(nil)
				delete(source, key)
				if caseName == "blank" {
					source[key] = bad
				}
				_, err := config.Resolve(source)
				if err == nil || !strings.Contains(err.Error(), key+" is mandatory in every plane") {
					t.Errorf("err = %v, want the mandatory-secret failure", err)
				}
				if err != nil && bad != "" && strings.Contains(err.Error(), bad) {
					t.Errorf("err = %v; the attempted secret must never be echoed", err)
				}
			})
		}
	}

	t.Run("API_KEY shorter than 16 characters fails", func(t *testing.T) {
		_, err := config.Resolve(withkey(map[string]string{"API_KEY": "0123456789abcde"}))
		if err == nil || !strings.Contains(err.Error(), "API_KEY must be at least 16 characters") {
			t.Errorf("err = %v, want the minimum-length failure", err)
		}
		if err != nil && strings.Contains(err.Error(), "0123456789abcde") {
			t.Errorf("err = %v; the attempted secret must never be echoed", err)
		}
	})
	t.Run("PADDLE_WEBHOOK_SECRET shorter than 16 characters fails", func(t *testing.T) {
		_, err := config.Resolve(withkey(map[string]string{"PADDLE_WEBHOOK_SECRET": "0123456789abcde"}))
		if err == nil || !strings.Contains(err.Error(), "PADDLE_WEBHOOK_SECRET must be at least 16 characters") {
			t.Errorf("err = %v, want the minimum-length failure", err)
		}
	})
	t.Run("short credentials serve at exactly 16 characters, trimmed", func(t *testing.T) {
		cfg, err := config.Resolve(withkey(map[string]string{
			"API_KEY":               " xq3wq8ne7an349er ",
			"PADDLE_WEBHOOK_SECRET": " abcdef0123456789 ",
		}))
		if err != nil {
			t.Fatal(err)
		}
		if cfg.APIKey != "xq3wq8ne7an349er" {
			t.Errorf("APIKey = %q, want the trimmed 16-character value", cfg.APIKey)
		}
		if cfg.PaddleSecret != "abcdef0123456789" {
			t.Errorf("PaddleSecret = %q, want the trimmed 16-character value", cfg.PaddleSecret)
		}
	})

	for caseName, bad := range map[string]string{
		"garbage":  "big",
		"blank":    "  ",
		"zero":     "0",
		"negative": "-1",
	} {
		t.Run("MAX_BODY_BYTES "+caseName+" fail-closes to 1 MiB", func(t *testing.T) {
			cfg, err := config.Resolve(withkey(map[string]string{"MAX_BODY_BYTES": bad}))
			if err != nil {
				t.Fatal(err)
			}
			if cfg.MaxBodyBytes != 1<<20 {
				t.Errorf("MaxBodyBytes = %d, want the fail-closed 1 MiB default", cfg.MaxBodyBytes)
			}
		})
	}

	t.Run("MAX_BODY_BYTES valid serves", func(t *testing.T) {
		cfg, err := config.Resolve(withkey(map[string]string{"MAX_BODY_BYTES": "2048"}))
		if err != nil {
			t.Fatal(err)
		}
		if cfg.MaxBodyBytes != 2048 {
			t.Errorf("MaxBodyBytes = %d, want 2048", cfg.MaxBodyBytes)
		}
	})

	t.Run("unknown plane keys ride along ignored", func(t *testing.T) {
		cfg, err := config.Resolve(withkey(map[string]string{"QUEUE_URL": "https://x/a", "OTEL_SERVICE_NAME": "payment-webhook"}))
		if err != nil {
			t.Fatal(err)
		}
		if cfg.Port != 8080 {
			t.Errorf("Port = %d, want 8080; unknown keys must not touch the contract", cfg.Port)
		}
	})
}

func TestLoadEndToEnd(t *testing.T) {
	t.Run("dev boots on the file plane", func(t *testing.T) {
		t.Setenv("ENV_TYPE", "dev")
		t.Chdir(t.TempDir())
		writeEnvPlane(t)

		cfg, err := config.Load()
		if err != nil {
			t.Fatal(err)
		}
		if cfg.Port != 9137 || cfg.DrainTimeout != 250*time.Millisecond || cfg.APIKey != testAPIKey {
			t.Errorf("cfg = %+v, want Port 9137, DrainTimeout 250ms, and the shared key from infra/.env", cfg)
		}
		if cfg.PaddleSecret != testPaddleSecret {
			t.Errorf("PaddleSecret = %q, want the plane value from infra/.env", cfg.PaddleSecret)
		}
		if cfg.MaxBodyBytes != 2048 {
			t.Errorf("MaxBodyBytes = %d, want 2048 from the file plane", cfg.MaxBodyBytes)
		}
	})

	t.Run("dev boots env-only when the file plane is absent", func(t *testing.T) {
		t.Setenv("ENV_TYPE", "dev")
		t.Setenv("PORT", "9138")
		t.Setenv("API_KEY", testAPIKey)
		t.Setenv("PADDLE_WEBHOOK_SECRET", testPaddleSecret)
		t.Chdir(t.TempDir())

		cfg, err := config.Load()
		if err != nil {
			t.Fatal(err)
		}
		if cfg.Port != 9138 || cfg.DrainTimeout != 10*time.Second || cfg.APIKey != testAPIKey {
			t.Errorf("cfg = %+v, want Port 9138, the 10s default, and the key from the environment", cfg)
		}
		if cfg.PaddleSecret != testPaddleSecret || cfg.MaxBodyBytes != 1<<20 {
			t.Errorf("cfg = %+v, want the plane paddle secret and the 1 MiB bound default", cfg)
		}
	})

	t.Run("missing API_KEY fails wrapped without echo", func(t *testing.T) {
		t.Setenv("ENV_TYPE", "dev")
		t.Chdir(t.TempDir())

		_, err := config.Load()
		var cfgErr *config.ConfigError
		if !errors.As(err, &cfgErr) || !strings.Contains(err.Error(), "API_KEY is mandatory") {
			t.Errorf("err = %v, want a *ConfigError naming the mandatory secret", err)
		}
	})

	t.Run("prod flick refuses wrapped once", func(t *testing.T) {
		t.Setenv("ENV_TYPE", "prod")
		t.Setenv("API_KEY", testAPIKey)
		t.Chdir(t.TempDir())

		_, err := config.Load()
		var cfgErr *config.ConfigError
		if !errors.As(err, &cfgErr) || !strings.Contains(err.Error(), "refuses") {
			t.Errorf("err = %v, want a *ConfigError carrying the prod refusal", err)
		}
	})

	t.Run("unknown flick refuses wrapped once", func(t *testing.T) {
		t.Setenv("ENV_TYPE", "qa")
		t.Setenv("API_KEY", testAPIKey)
		t.Chdir(t.TempDir())

		_, err := config.Load()
		var cfgErr *config.ConfigError
		if !errors.As(err, &cfgErr) || !strings.Contains(err.Error(), "not a flick") {
			t.Errorf("err = %v, want a *ConfigError carrying the flick failure", err)
		}
	})

	t.Run("port identity failure crosses the boundary typed", func(t *testing.T) {
		t.Setenv("ENV_TYPE", "dev")
		t.Setenv("PORT", "70000")
		t.Setenv("API_KEY", testAPIKey)
		t.Chdir(t.TempDir())

		_, err := config.Load()
		var cfgErr *config.ConfigError
		if !errors.As(err, &cfgErr) || !strings.Contains(err.Error(), "PORT") {
			t.Errorf("err = %v, want a *ConfigError naming PORT", err)
		}
	})
}

// writeEnvPlane seeds the default infra/.env under the current directory.
func writeEnvPlane(t *testing.T) {
	t.Helper()
	if err := os.MkdirAll("infra", 0o755); err != nil {
		t.Fatal(err)
	}
	plane := "PORT=9137\nDRAIN_TIMEOUT=250ms\nAPI_KEY=" + testAPIKey +
		"\nPADDLE_WEBHOOK_SECRET=" + testPaddleSecret + "\nMAX_BODY_BYTES=2048\n"
	if err := os.WriteFile(filepath.Join("infra", ".env"), []byte(plane), 0o600); err != nil {
		t.Fatal(err)
	}
}
