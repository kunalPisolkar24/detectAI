package config_test

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/config"
)

const testLicenseKey = "lic-0123456789abcdef79"
const testOTelEndpoint = "https://otlp.eu01.nr-data.net"
const testMongoURI = "mongodb://localhost:27017"

type mapSource map[string]string

func (m mapSource) Get(key string) (string, bool) {
	value, ok := m[key]
	return value, ok
}

// with merges the extra keys over the always-required MONGO_URI.
func with(extra map[string]string) mapSource {
	source := mapSource{"MONGO_URI": testMongoURI}
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
	t.Run("a plane with only the required URI keeps every default", func(t *testing.T) {
		cfg, err := config.Resolve(with(nil))
		if err != nil {
			t.Fatal(err)
		}
		if cfg.Port != 8090 {
			t.Errorf("Port = %d, want the identity default 8090", cfg.Port)
		}
		if cfg.DrainTimeout != 10*time.Second {
			t.Errorf("DrainTimeout = %v, want the budget default 10s", cfg.DrainTimeout)
		}
		if cfg.OTelEndpoint != "" {
			t.Errorf("OTelEndpoint = %q, want the unset gate", cfg.OTelEndpoint)
		}
		if cfg.NewRelicKey != "" {
			t.Errorf("NewRelicKey = non-empty; without an endpoint the boot stays credential-free")
		}
		if cfg.OTelName != "chats" {
			t.Errorf("OTelName = %q, want the default", cfg.OTelName)
		}
		if cfg.OTelVersion != "dev" {
			t.Errorf("OTelVersion = %q, want the dev fallback", cfg.OTelVersion)
		}
		if cfg.OTelSampleRatio != 1.0 {
			t.Errorf("OTelSampleRatio = %v, want the unsampled-full default", cfg.OTelSampleRatio)
		}
		if cfg.MongoURI != testMongoURI {
			t.Errorf("MongoURI = %q, want the seeded URI", cfg.MongoURI)
		}
		if cfg.MongoDatabase != "chat_db" {
			t.Errorf("MongoDatabase = %q, want the default", cfg.MongoDatabase)
		}
	})

	t.Run("a missing MONGO_URI fails the boot", func(t *testing.T) {
		_, err := config.Resolve(mapSource{})
		if err == nil || !strings.Contains(err.Error(), "MONGO_URI is required") {
			t.Errorf("err = %v, want the required-URI failure", err)
		}
	})

	for caseName, bad := range map[string]string{
		"blank":        "",
		"whitespace":   "   ",
		"wrong scheme": "postgres://localhost:5432",
		"no scheme":    "localhost:27017",
	} {
		t.Run("MONGO_URI "+caseName+" fails naming the var", func(t *testing.T) {
			_, err := config.Resolve(with(map[string]string{"MONGO_URI": bad}))
			if err == nil || !strings.Contains(err.Error(), "MONGO_URI must be a mongodb:// or mongodb+srv:// URI") {
				t.Errorf("err = %v, want the URI shape failure", err)
			}
		})
	}

	t.Run("MONGO_URI trims and serves", func(t *testing.T) {
		cfg, err := config.Resolve(with(map[string]string{"MONGO_URI": " " + testMongoURI + " "}))
		if err != nil {
			t.Fatal(err)
		}
		if cfg.MongoURI != testMongoURI {
			t.Errorf("MongoURI = %q, want the trimmed URI", cfg.MongoURI)
		}
	})

	t.Run("MONGO_DATABASE overrides the default", func(t *testing.T) {
		cfg, err := config.Resolve(with(map[string]string{"MONGO_DATABASE": "chats_prod"}))
		if err != nil {
			t.Fatal(err)
		}
		if cfg.MongoDatabase != "chats_prod" {
			t.Errorf("MongoDatabase = %q, want the override", cfg.MongoDatabase)
		}
	})

	t.Run("a whitespace-only MONGO_DATABASE drops to the default", func(t *testing.T) {
		cfg, err := config.Resolve(with(map[string]string{"MONGO_DATABASE": "   "}))
		if err != nil {
			t.Fatal(err)
		}
		if cfg.MongoDatabase != "chat_db" {
			t.Errorf("MongoDatabase = %q, want the default", cfg.MongoDatabase)
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
			_, err := config.Resolve(with(map[string]string{"PORT": bad}))
			if err == nil || !strings.Contains(err.Error(), "PORT must be an integer between 1 and 65535") {
				t.Errorf("err = %v, want the PORT identity failure", err)
			}
		})
	}

	t.Run("PORT within bounds serves", func(t *testing.T) {
		cfg, err := config.Resolve(with(map[string]string{"PORT": "9137"}))
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
			cfg, err := config.Resolve(with(map[string]string{"DRAIN_TIMEOUT": bad}))
			if err != nil {
				t.Fatal(err)
			}
			if cfg.DrainTimeout != 10*time.Second {
				t.Errorf("DrainTimeout = %v, want the 10s fail-closed default", cfg.DrainTimeout)
			}
		})
	}

	t.Run("DRAIN_TIMEOUT valid serves", func(t *testing.T) {
		cfg, err := config.Resolve(with(map[string]string{"DRAIN_TIMEOUT": "12s"}))
		if err != nil {
			t.Fatal(err)
		}
		if cfg.DrainTimeout != 12*time.Second {
			t.Errorf("DrainTimeout = %v, want 12s", cfg.DrainTimeout)
		}
	})

	t.Run("a blank endpoint is an unset one", func(t *testing.T) {
		cfg, err := config.Resolve(with(map[string]string{"OTEL_EXPORTER_OTLP_ENDPOINT": "   "}))
		if err != nil {
			t.Fatal(err)
		}
		if cfg.OTelEndpoint != "" {
			t.Errorf("OTelEndpoint = %q, want blank normalized to the disabled gate", cfg.OTelEndpoint)
		}
	})

	t.Run("a set endpoint demands the license key", func(t *testing.T) {
		_, err := config.Resolve(with(map[string]string{"OTEL_EXPORTER_OTLP_ENDPOINT": testOTelEndpoint}))
		if err == nil || !strings.Contains(err.Error(), "NEW_RELIC_LICENSE_KEY must be at least 16 characters") {
			t.Errorf("err = %v, want the endpoint-gate failure", err)
		}
	})

	t.Run("a short license key fails without echo", func(t *testing.T) {
		short := "lic-short"
		_, err := config.Resolve(with(map[string]string{
			"OTEL_EXPORTER_OTLP_ENDPOINT": testOTelEndpoint,
			"NEW_RELIC_LICENSE_KEY":       short,
		}))
		if err == nil || !strings.Contains(err.Error(), "NEW_RELIC_LICENSE_KEY must be at least 16 characters") {
			t.Errorf("err = %v, want the endpoint-gate failure", err)
		}
		if err != nil && strings.Contains(err.Error(), short) {
			t.Errorf("err = %v; the attempted secret must never be echoed", err)
		}
	})

	t.Run("the endpoint-gated credential holds at its floor, trimmed", func(t *testing.T) {
		cfg, err := config.Resolve(with(map[string]string{
			"OTEL_EXPORTER_OTLP_ENDPOINT": " " + testOTelEndpoint + " ",
			"NEW_RELIC_LICENSE_KEY":       " " + testLicenseKey + " ",
		}))
		if err != nil {
			t.Fatal(err)
		}
		if cfg.OTelEndpoint != testOTelEndpoint {
			t.Errorf("OTelEndpoint = %q, want the trimmed endpoint", cfg.OTelEndpoint)
		}
		if cfg.NewRelicKey != testLicenseKey {
			t.Errorf("NewRelicKey = %q, want the trimmed key", cfg.NewRelicKey)
		}
	})

	for caseName, bad := range map[string]string{
		"garbage":        "junks",
		"zero":           "0",
		"negative":       "-0.5",
		"over one":       "1.01",
		"NaN":            "NaN",
		"lowercase NaN":  "nan",
		"plus infinity":  "Inf",
		"minus infinity": "-Inf",
	} {
		t.Run("OTEL_TRACE_SAMPLE_RATIO "+caseName+" fails loud naming the var", func(t *testing.T) {
			_, err := config.Resolve(with(map[string]string{"OTEL_TRACE_SAMPLE_RATIO": bad}))
			if err == nil || !strings.Contains(err.Error(), "OTEL_TRACE_SAMPLE_RATIO must lie in the interval (0, 1]") {
				t.Errorf("err = %v, want the sample-ratio failure", err)
			}
		})
	}

	t.Run("OTEL_TRACE_SAMPLE_RATIO inside the interval serves", func(t *testing.T) {
		cfg, err := config.Resolve(with(map[string]string{
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
		if cfg.OTelName != "chats" {
			t.Errorf("OTelName = %q, want the blank value dropping out to the default", cfg.OTelName)
		}
		if cfg.OTelVersion != "1.2.3" {
			t.Errorf("OTelVersion = %q, want the explicit version", cfg.OTelVersion)
		}
	})

	t.Run("a whitespace-only OTEL_SERVICE_VERSION drops to the default", func(t *testing.T) {
		cfg, err := config.Resolve(with(map[string]string{"OTEL_SERVICE_VERSION": "   "}))
		if err != nil {
			t.Fatal(err)
		}
		if cfg.OTelVersion != "dev" {
			t.Errorf("OTelVersion = %q, want the dev fallback", cfg.OTelVersion)
		}
	})

	t.Run("unknown plane keys ride along ignored", func(t *testing.T) {
		cfg, err := config.Resolve(with(map[string]string{"LEGACY_GATEWAY_URL": "amqp://old", "OLD_API_KEY": "legacy-secret-16"}))
		if err != nil {
			t.Fatal(err)
		}
		if cfg.Port != 8090 {
			t.Errorf("Port = %d, want 8090; unknown keys must not touch the contract", cfg.Port)
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
		if cfg.OTelSampleRatio != 0.5 || cfg.OTelEndpoint != "" {
			t.Errorf("cfg = %+v, want the plane's half sampling with the endpoint gate still unset", cfg)
		}
		if cfg.MongoURI != testMongoURI || cfg.MongoDatabase != "chat_db" {
			t.Errorf("cfg = %+v, want the plane's mongo URI with the default database", cfg)
		}
	})

	t.Run("dev boots env-only when the file plane is absent", func(t *testing.T) {
		t.Setenv("ENV_TYPE", "dev")
		t.Setenv("PORT", "9138")
		t.Setenv("MONGO_URI", testMongoURI)
		t.Chdir(t.TempDir())

		cfg, err := config.Load()
		if err != nil {
			t.Fatal(err)
		}
		if cfg.Port != 9138 || cfg.DrainTimeout != 10*time.Second {
			t.Errorf("cfg = %+v, want Port 9138 and the 10s default drain", cfg)
		}
		if cfg.MongoURI != testMongoURI {
			t.Errorf("cfg = %+v, want the env-served mongo URI", cfg)
		}
	})

	t.Run("a set endpoint without the license key fails wrapped", func(t *testing.T) {
		t.Setenv("ENV_TYPE", "dev")
		t.Setenv("OTEL_EXPORTER_OTLP_ENDPOINT", testOTelEndpoint)
		t.Chdir(t.TempDir())

		_, err := config.Load()
		var cfgErr *config.ConfigError
		if !errors.As(err, &cfgErr) || !strings.Contains(err.Error(), "NEW_RELIC_LICENSE_KEY must be at least 16 characters") {
			t.Errorf("err = %v, want a *ConfigError naming the endpoint gate", err)
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

	t.Run("process env values never rescue a prod boot", func(t *testing.T) {
		t.Setenv("ENV_TYPE", "prod")
		offlineProd(t, "eu-central-1")
		t.Setenv("AWS_ENDPOINT_URL_SECRETS_MANAGER", "http://127.0.0.1:1")
		t.Setenv("AWS_ENDPOINT_URL_SSM", "http://127.0.0.1:1")
		t.Setenv("PORT", "9137")
		t.Setenv("DRAIN_TIMEOUT", "12s")
		t.Setenv("OTEL_EXPORTER_OTLP_ENDPOINT", testOTelEndpoint)
		t.Setenv("NEW_RELIC_LICENSE_KEY", testLicenseKey)

		_, err := config.Load()
		var cfgErr *config.ConfigError
		if !errors.As(err, &cfgErr) || !strings.Contains(err.Error(), `could not fetch secret "detectai/chats/secrets"`) {
			t.Errorf("err = %v, want the prod fetch failure; the process env must not serve the prod plane", err)
		}
	})

	t.Run("an empty exported PORT fails the boot", func(t *testing.T) {
		t.Setenv("ENV_TYPE", "dev")
		t.Setenv("PORT", "")
		t.Chdir(t.TempDir())

		_, err := config.Load()
		var cfgErr *config.ConfigError
		if !errors.As(err, &cfgErr) || !strings.Contains(err.Error(), "PORT must be an integer between 1 and 65535") {
			t.Errorf("err = %v, want a *ConfigError naming PORT", err)
		}
	})

	t.Run("a malformed dev file plane fails wrapped", func(t *testing.T) {
		t.Setenv("ENV_TYPE", "dev")
		t.Chdir(t.TempDir())
		if err := os.MkdirAll("infra", 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join("infra", ".env"), []byte("not a dotenv line\n"), 0o600); err != nil {
			t.Fatal(err)
		}

		_, err := config.Load()
		var cfgErr *config.ConfigError
		if !errors.As(err, &cfgErr) || !strings.Contains(err.Error(), `is malformed at line 1`) {
			t.Errorf("err = %v, want a *ConfigError naming the malformed line", err)
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
	plane := "PORT=9137\nDRAIN_TIMEOUT=12s\nOTEL_TRACE_SAMPLE_RATIO=0.5\nMONGO_URI=" + testMongoURI + "\n"
	if err := os.WriteFile(filepath.Join("infra", ".env"), []byte(plane), 0o600); err != nil {
		t.Fatal(err)
	}
}
