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

const testPaddleSecret = "paddle-change-me-16-chars"
const testQueueURL = "https://sqs.eu-central-1.amazonaws.com/123456789012/payment_events.fifo"
const testOTelEndpoint = "https://otlp.eu01.nr-data.net"

type mapSource map[string]string

func (m mapSource) Get(key string) (string, bool) {
	value, ok := m[key]
	return value, ok
}

// withkey merges the mandatory keys so each case carries one failure point.
func withkey(extra map[string]string) mapSource {
	source := mapSource{"PADDLE_WEBHOOK_SECRET": testPaddleSecret, "QUEUE_URL": testQueueURL}
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
		"unset serves dev": {wantOwn: "dev"},
		"empty serves dev": {value: "", wantOwn: "dev"},
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
		// 12s clears the clamp floor while proving the plane read out-reads the default.
		cfg, err := config.Resolve(withkey(map[string]string{"DRAIN_TIMEOUT": "12s"}))
		if err != nil {
			t.Fatal(err)
		}
		if cfg.DrainTimeout != 12*time.Second {
			t.Errorf("DrainTimeout = %v, want 12s", cfg.DrainTimeout)
		}
	})

	// The secret is dropped or blanked; the failure names the var, never the value.
	for caseName, bad := range map[string]string{
		"missing": "",
		"blank":   "   ",
	} {
		t.Run("PADDLE_WEBHOOK_SECRET "+caseName+" fails without echo", func(t *testing.T) {
			source := withkey(nil)
			delete(source, "PADDLE_WEBHOOK_SECRET")
			if caseName == "blank" {
				source["PADDLE_WEBHOOK_SECRET"] = bad
			}
			_, err := config.Resolve(source)
			if err == nil || !strings.Contains(err.Error(), "PADDLE_WEBHOOK_SECRET is mandatory in every plane") {
				t.Errorf("err = %v, want the mandatory-secret failure", err)
			}
			if err != nil && bad != "" && strings.Contains(err.Error(), bad) {
				t.Errorf("err = %v; the attempted secret must never be echoed", err)
			}
		})
	}

	t.Run("PADDLE_WEBHOOK_SECRET shorter than 16 characters fails", func(t *testing.T) {
		_, err := config.Resolve(withkey(map[string]string{"PADDLE_WEBHOOK_SECRET": "0123456789abcde"}))
		if err == nil || !strings.Contains(err.Error(), "PADDLE_WEBHOOK_SECRET must be at least 16 characters") {
			t.Errorf("err = %v, want the minimum-length failure", err)
		}
		if err != nil && strings.Contains(err.Error(), "0123456789abcde") {
			t.Errorf("err = %v; the attempted secret must never be echoed", err)
		}
	})
	t.Run("the short credential serves at exactly 16 characters, trimmed", func(t *testing.T) {
		cfg, err := config.Resolve(withkey(map[string]string{
			"PADDLE_WEBHOOK_SECRET": " abcdef0123456789 ",
		}))
		if err != nil {
			t.Fatal(err)
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

	t.Run("QUEUE_URL serves for real and Floci emulator shapes", func(t *testing.T) {
		for name, queueURL := range map[string]string{
			"prod shape":  "https://sqs.eu-central-1.amazonaws.com/123456789012/payment_events.fifo",
			"Floci shape": "http://localhost:4566/000000000000/payment_events.fifo",
		} {
			t.Run(name, func(t *testing.T) {
				cfg, err := config.Resolve(withkey(map[string]string{"QUEUE_URL": queueURL}))
				if err != nil {
					t.Fatal(err)
				}
				if cfg.QueueURL != queueURL {
					t.Errorf("QueueURL = %q, want %q round-tripped", cfg.QueueURL, queueURL)
				}
			})
		}
	})

	for caseName, bad := range map[string]string{
		"missing":      "",
		"not a url":    "nonsense",
		"wrong scheme": "ftp://h/account/queue.fifo",
		"no host":      "https:///account/queue.fifo",
		"queue-less":   "https://sqs.eu-central-1.amazonaws.com/123456789012",
	} {
		t.Run("QUEUE_URL "+caseName+" fails", func(t *testing.T) {
			_, err := config.Resolve(withkey(map[string]string{"QUEUE_URL": bad}))
			if err == nil || !strings.Contains(err.Error(), "QUEUE_URL") {
				t.Errorf("err = %v, want the QUEUE_URL failure", err)
			}
		})
	}

	for caseName, bad := range map[string]string{
		"garbage":  "junks",
		"zero":     "0s",
		"negative": "-5s",
	} {
		t.Run("PUBLISH_BUDGET "+caseName+" fail-closes to 5s", func(t *testing.T) {
			cfg, err := config.Resolve(withkey(map[string]string{"PUBLISH_BUDGET": bad}))
			if err != nil {
				t.Fatal(err)
			}
			if cfg.PublishBudget != 5*time.Second {
				t.Errorf("PublishBudget = %v, want the fail-closed 5s default", cfg.PublishBudget)
			}
		})
	}

	t.Run("PUBLISH_BUDGET valid serves", func(t *testing.T) {
		cfg, err := config.Resolve(withkey(map[string]string{"PUBLISH_BUDGET": "2s"}))
		if err != nil {
			t.Fatal(err)
		}
		if cfg.PublishBudget != 2*time.Second {
			t.Errorf("PublishBudget = %v, want 2s", cfg.PublishBudget)
		}
		if cfg.DrainTimeout != 10*time.Second { // 2 < 5: the default drain already clears the floor
			t.Errorf("DrainTimeout = %v, want the 10s default", cfg.DrainTimeout)
		}
	})

	t.Run("drain clamps over a bigger budget", func(t *testing.T) {
		cfg, err := config.Resolve(withkey(map[string]string{"DRAIN_TIMEOUT": "250ms", "PUBLISH_BUDGET": "8s"}))
		if err != nil {
			t.Fatal(err)
		}
		if cfg.DrainTimeout != 13*time.Second { // 8s budget + 5s slack
			t.Errorf("DrainTimeout = %v, want the 13s clamp floor", cfg.DrainTimeout)
		}
	})

	t.Run("unknown plane keys ride along ignored", func(t *testing.T) {
		cfg, err := config.Resolve(withkey(map[string]string{"LEGACY_GATEWAY_URL": "amqp://old", "OLD_API_KEY": "legacy-secret-16"}))
		if err != nil {
			t.Fatal(err)
		}
		if cfg.Port != 8080 {
			t.Errorf("Port = %d, want 8080; unknown keys must not touch the contract", cfg.Port)
		}
	})

	t.Run("the OTel keys keep defaults with the endpoint unset", func(t *testing.T) {
		cfg, err := config.Resolve(withkey(nil))
		if err != nil {
			t.Fatal(err)
		}
		if cfg.OTelEndpoint != "" {
			t.Errorf("OTelEndpoint = %q, want the unset gate", cfg.OTelEndpoint)
		}
		if cfg.NewRelicKey != "" {
			t.Errorf("NewRelicKey = non-empty; without an endpoint the boot stays credential-free")
		}
		if cfg.OTelName != "payment-webhook" {
			t.Errorf("OTelName = %q, want the default", cfg.OTelName)
		}
		if cfg.OTelVersion != "dev" {
			t.Errorf("OTelVersion = %q, want the dev fallback", cfg.OTelVersion)
		}
		if cfg.OTelSampleRatio != 1.0 {
			t.Errorf("OTelSampleRatio = %v, want the unsampled-full default", cfg.OTelSampleRatio)
		}
	})

	t.Run("a blank endpoint is an unset one", func(t *testing.T) {
		cfg, err := config.Resolve(withkey(map[string]string{"OTEL_EXPORTER_OTLP_ENDPOINT": "   "}))
		if err != nil {
			t.Fatal(err)
		}
		if cfg.OTelEndpoint != "" {
			t.Errorf("OTelEndpoint = %q, want blank normalized to the disabled gate", cfg.OTelEndpoint)
		}
	})

	t.Run("a set endpoint demands the license key", func(t *testing.T) {
		_, err := config.Resolve(withkey(map[string]string{"OTEL_EXPORTER_OTLP_ENDPOINT": testOTelEndpoint}))
		if err == nil || !strings.Contains(err.Error(), "NEW_RELIC_LICENSE_KEY must be at least 16 characters") {
			t.Errorf("err = %v, want the endpoint-gate failure", err)
		}
	})

	t.Run("the endpoint-gated credential holds at its floor, trimmed", func(t *testing.T) {
		cfg, err := config.Resolve(withkey(map[string]string{
			"OTEL_EXPORTER_OTLP_ENDPOINT": " " + testOTelEndpoint + " ",
			"NEW_RELIC_LICENSE_KEY":       " lic-0123456789abcdef79 ",
		}))
		if err != nil {
			t.Fatal(err)
		}
		if cfg.OTelEndpoint != testOTelEndpoint {
			t.Errorf("OTelEndpoint = %q, want the trimmed endpoint", cfg.OTelEndpoint)
		}
		if cfg.NewRelicKey != "lic-0123456789abcdef79" {
			t.Errorf("NewRelicKey = %q, want the trimmed key", cfg.NewRelicKey)
		}
	})

	for caseName, bad := range map[string]string{
		"garbage":  "junks",
		"zero":     "0",
		"negative": "-0.5",
		"over one": "1.01",
	} {
		t.Run("OTEL_TRACE_SAMPLE_RATIO "+caseName+" fails loud naming the var", func(t *testing.T) {
			_, err := config.Resolve(withkey(map[string]string{"OTEL_TRACE_SAMPLE_RATIO": bad}))
			if err == nil || !strings.Contains(err.Error(), "OTEL_TRACE_SAMPLE_RATIO must lie in the interval (0, 1]") {
				t.Errorf("err = %v, want the sample-ratio failure", err)
			}
		})
	}

	t.Run("OTEL_TRACE_SAMPLE_RATIO inside the interval serves", func(t *testing.T) {
		cfg, err := config.Resolve(withkey(map[string]string{
			"OTEL_TRACE_SAMPLE_RATIO": "0.25",
			"OTEL_SERVICE_NAME":       "   ",
			"OTEL_SERVICE_VERSION":    "1.2.3",
		}))
		if err != nil {
			t.Fatal(err)
		}
		if cfg.OTelSampleRatio != 0.25 {
			t.Errorf("OTelSampleRatio = %v, want 0.25", cfg.OTelSampleRatio)
		}
		if cfg.OTelName != "payment-webhook" {
			t.Errorf("OTelName = %q, want the blank value dropping out to the default", cfg.OTelName)
		}
		if cfg.OTelVersion != "1.2.3" {
			t.Errorf("OTelVersion = %q, want the explicit version", cfg.OTelVersion)
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
		if cfg.Port != 9137 || cfg.DrainTimeout != 12*time.Second {
			t.Errorf("cfg = %+v, want Port 9137 and the 12s drain from infra/.env", cfg)
		}
		if cfg.PaddleSecret != testPaddleSecret {
			t.Errorf("PaddleSecret = %q, want the plane value from infra/.env", cfg.PaddleSecret)
		}
		if cfg.MaxBodyBytes != 2048 {
			t.Errorf("MaxBodyBytes = %d, want 2048 from the file plane", cfg.MaxBodyBytes)
		}
		if cfg.QueueURL != testQueueURL || cfg.PublishBudget != 7*time.Second {
			t.Errorf("cfg = %+v, want the plane queue URL and a 7s budget from infra/.env", cfg)
		}
		if cfg.OTelSampleRatio != 0.5 || cfg.OTelEndpoint != "" {
			t.Errorf("cfg = %+v, want the plane's half sampling with the endpoint gate still unset", cfg)
		}
	})

	t.Run("dev boots env-only when the file plane is absent", func(t *testing.T) {
		t.Setenv("ENV_TYPE", "dev")
		t.Setenv("PORT", "9138")
		t.Setenv("PADDLE_WEBHOOK_SECRET", testPaddleSecret)
		t.Setenv("QUEUE_URL", testQueueURL)
		t.Chdir(t.TempDir())

		cfg, err := config.Load()
		if err != nil {
			t.Fatal(err)
		}
		if cfg.Port != 9138 || cfg.DrainTimeout != 10*time.Second {
			t.Errorf("cfg = %+v, want Port 9138 and the 10s default drain", cfg)
		}
		if cfg.PaddleSecret != testPaddleSecret || cfg.MaxBodyBytes != 1<<20 {
			t.Errorf("cfg = %+v, want the plane paddle secret and the 1 MiB bound default", cfg)
		}
		if cfg.QueueURL != testQueueURL || cfg.PublishBudget != 5*time.Second {
			t.Errorf("cfg = %+v, want the plane queue URL and the 5s budget default", cfg)
		}
	})

	t.Run("missing PADDLE_WEBHOOK_SECRET fails wrapped without echo", func(t *testing.T) {
		t.Setenv("ENV_TYPE", "dev")
		t.Chdir(t.TempDir())

		_, err := config.Load()
		var cfgErr *config.ConfigError
		if !errors.As(err, &cfgErr) || !strings.Contains(err.Error(), "PADDLE_WEBHOOK_SECRET is mandatory") {
			t.Errorf("err = %v, want a *ConfigError naming the mandatory secret", err)
		}
	})

	t.Run("prod boot fails wrapped once when the region is unresolvable", func(t *testing.T) {
		t.Setenv("ENV_TYPE", "prod")
		offlineProd(t, "")
		t.Chdir(t.TempDir())

		_, err := config.Load()
		var cfgErr *config.ConfigError
		if !errors.As(err, &cfgErr) || !strings.Contains(err.Error(), "needs AWS_REGION") {
			t.Errorf("err = %v, want a *ConfigError naming the missing region", err)
		}
	})

	t.Run("unknown flick refuses wrapped once", func(t *testing.T) {
		t.Setenv("ENV_TYPE", "qa")
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
		t.Chdir(t.TempDir())

		_, err := config.Load()
		var cfgErr *config.ConfigError
		if !errors.As(err, &cfgErr) || !strings.Contains(err.Error(), "PORT") {
			t.Errorf("err = %v, want a *ConfigError naming PORT", err)
		}
	})
}

func writeEnvPlane(t *testing.T) {
	t.Helper()
	if err := os.MkdirAll("infra", 0o755); err != nil {
		t.Fatal(err)
	}
	plane := "PORT=9137\nDRAIN_TIMEOUT=12s\nPADDLE_WEBHOOK_SECRET=" + testPaddleSecret +
		"\nMAX_BODY_BYTES=2048" +
		"\nQUEUE_URL=" + testQueueURL + "\nPUBLISH_BUDGET=7s" +
		"\nOTEL_TRACE_SAMPLE_RATIO=0.5\n"
	if err := os.WriteFile(filepath.Join("infra", ".env"), []byte(plane), 0o600); err != nil {
		t.Fatal(err)
	}
}
