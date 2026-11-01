package config

import (
	"errors"
	"os"
	"strings"
	"testing"
	"time"
)

type mapSource map[string]string

func (m mapSource) Get(key string) (string, bool) {
	value, ok := m[key]
	return value, ok
}

func TestDeploymentFlick(t *testing.T) {
	for name, tc := range map[string]struct {
		value   string
		set     bool
		wantErr string
		wantOwn string
	}{
		"unset fails":      {wantErr: "ENV_TYPE is unset"},
		"empty fails":      {value: "", set: true, wantErr: "ENV_TYPE is unset"},
		"wrong case fails": {value: "DEV", set: true, wantErr: `ENV_TYPE "DEV" is not a flick`},
		"unknown fails":    {value: "qa", set: true, wantErr: `ENV_TYPE "qa" is not a flick`},
		"dev serves":       {value: "dev", set: true, wantOwn: "dev"},
		"prod serves":      {value: "prod", set: true, wantOwn: "prod"},
	} {
		t.Run(name, func(t *testing.T) {
			t.Setenv("ENV_TYPE", tc.value)
			flick, err := DeploymentFlick()
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
	t.Run("empty source keeps both defaults", func(t *testing.T) {
		cfg, err := Resolve(mapSource{})
		if err != nil {
			t.Fatal(err)
		}
		if cfg.Port != 8080 {
			t.Errorf("Port = %d, want the identity default 8080", cfg.Port)
		}
		if cfg.DrainTimeout != 10*time.Second {
			t.Errorf("DrainTimeout = %v, want the budget default 10s", cfg.DrainTimeout)
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
			_, err := Resolve(mapSource{"PORT": bad})
			if err == nil || !strings.Contains(err.Error(), "PORT must be an integer between 1 and 65535") {
				t.Errorf("err = %v, want the PORT identity failure", err)
			}
		})
	}

	t.Run("PORT within bounds serves", func(t *testing.T) {
		cfg, err := Resolve(mapSource{"PORT": "9137"})
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
			cfg, err := Resolve(mapSource{"DRAIN_TIMEOUT": bad})
			if err != nil {
				t.Fatal(err)
			}
			if cfg.DrainTimeout != 10*time.Second {
				t.Errorf("DrainTimeout = %v, want the 10s fail-closed default", cfg.DrainTimeout)
			}
		})
	}

	t.Run("DRAIN_TIMEOUT valid serves", func(t *testing.T) {
		cfg, err := Resolve(mapSource{"DRAIN_TIMEOUT": "250ms"})
		if err != nil {
			t.Fatal(err)
		}
		if cfg.DrainTimeout != 250*time.Millisecond {
			t.Errorf("DrainTimeout = %v, want 250ms", cfg.DrainTimeout)
		}
	})

	t.Run("unknown plane keys ride along ignored", func(t *testing.T) {
		cfg, err := Resolve(mapSource{"QUEUE_URL": "https://x/a", "OTEL_SERVICE_NAME": "payment-webhook"})
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
		if err := os.WriteFile(".env", []byte("PORT=9137\nDRAIN_TIMEOUT=250ms\n"), 0o600); err != nil {
			t.Fatal(err)
		}

		cfg, err := Load()
		if err != nil {
			t.Fatal(err)
		}
		if cfg.Port != 9137 || cfg.DrainTimeout != 250*time.Millisecond {
			t.Errorf("cfg = %+v, want Port 9137 and DrainTimeout 250ms from .env", cfg)
		}
	})

	t.Run("dev boots env-only when the file plane is absent", func(t *testing.T) {
		t.Setenv("ENV_TYPE", "dev")
		t.Setenv("PORT", "9138")
		t.Chdir(t.TempDir())

		cfg, err := Load()
		if err != nil {
			t.Fatal(err)
		}
		if cfg.Port != 9138 || cfg.DrainTimeout != 10*time.Second {
			t.Errorf("cfg = %+v, want Port 9138 from the environment and the 10s default", cfg)
		}
	})

	t.Run("prod flick refuses wrapped once", func(t *testing.T) {
		t.Setenv("ENV_TYPE", "prod")
		t.Chdir(t.TempDir())

		_, err := Load()
		var cfgErr *ConfigError
		if !errors.As(err, &cfgErr) || !strings.Contains(err.Error(), "refuses") {
			t.Errorf("err = %v, want a *ConfigError carrying the prod refusal", err)
		}
	})

	t.Run("unknown flick refuses wrapped once", func(t *testing.T) {
		t.Setenv("ENV_TYPE", "qa")
		t.Chdir(t.TempDir())

		_, err := Load()
		var cfgErr *ConfigError
		if !errors.As(err, &cfgErr) || !strings.Contains(err.Error(), "not a flick") {
			t.Errorf("err = %v, want a *ConfigError carrying the flick failure", err)
		}
	})

	t.Run("port identity failure crosses the boundary typed", func(t *testing.T) {
		t.Setenv("ENV_TYPE", "dev")
		t.Setenv("PORT", "70000")
		t.Chdir(t.TempDir())

		_, err := Load()
		var cfgErr *ConfigError
		if !errors.As(err, &cfgErr) || !strings.Contains(err.Error(), "PORT") {
			t.Errorf("err = %v, want a *ConfigError naming PORT", err)
		}
	})
}
