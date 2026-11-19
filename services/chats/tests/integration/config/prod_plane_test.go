package config_test

import (
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/config"
)

// The prod plane through the real floci endpoint; the test skips when :4566 is unreachable.

func flociReachable() bool {
	conn, err := net.DialTimeout("tcp", "127.0.0.1:4566", time.Second)
	if err != nil {
		return false
	}
	conn.Close()
	return true
}

func envValues(t *testing.T) map[string]string {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "infra", ".env"))
	if err != nil {
		t.Skipf("config: the integration test reads infra/.env: %v", err)
	}
	values := map[string]string{}
	for _, line := range strings.Split(string(raw), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, found := strings.Cut(line, "=")
		if !found {
			continue
		}
		values[key] = value
	}
	return values
}

func TestProdLoadBranchesOnTheSeededFlociPlanes(t *testing.T) {
	if !flociReachable() {
		t.Skip("floci not reachable on :4566")
	}
	env := envValues(t)
	t.Setenv("ENV_TYPE", "prod")
	t.Setenv("AWS_REGION", env["AWS_REGION"])
	t.Setenv("AWS_ACCESS_KEY_ID", "test")
	t.Setenv("AWS_SECRET_ACCESS_KEY", "test")
	t.Setenv("AWS_CONFIG_FILE", filepath.Join(t.TempDir(), "config"))
	t.Setenv("AWS_SHARED_CREDENTIALS_FILE", filepath.Join(t.TempDir(), "credentials"))
	t.Setenv("AWS_ENDPOINT_URL_SECRETS_MANAGER", "http://localhost:4566")
	t.Setenv("AWS_ENDPOINT_URL_SSM", "http://localhost:4566")

	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("config.Load: %v", err)
	}

	// The license key is consumed only when the endpoint gate fires; Load
	// succeeding in prod already proves the blob fetch happened.
	wantKey := ""
	if env["OTEL_EXPORTER_OTLP_ENDPOINT"] != "" {
		wantKey = env["NEW_RELIC_LICENSE_KEY"]
	}
	if cfg.NewRelicKey != wantKey {
		t.Errorf("NewRelicKey = %q, want %q per the endpoint gate", cfg.NewRelicKey, wantKey)
	}
	if cfg.OTelEndpoint != env["OTEL_EXPORTER_OTLP_ENDPOINT"] {
		t.Errorf("OTelEndpoint = %q, want the seeded gate %q", cfg.OTelEndpoint, env["OTEL_EXPORTER_OTLP_ENDPOINT"])
	}
	// A key absent from the seeded file must serve its default; present, the seeded value.
	wantPort := 8090
	if env["PORT"] != "" {
		wantPort, _ = strconv.Atoi(env["PORT"])
	}
	if cfg.Port != wantPort {
		t.Errorf("Port = %d, want %d", cfg.Port, wantPort)
	}
	wantDrain := 10 * time.Second
	if env["DRAIN_TIMEOUT"] != "" {
		wantDrain, _ = time.ParseDuration(env["DRAIN_TIMEOUT"])
	}
	if cfg.DrainTimeout != wantDrain {
		t.Errorf("DrainTimeout = %v, want %v", cfg.DrainTimeout, wantDrain)
	}
	wantName := "chats"
	if env["OTEL_SERVICE_NAME"] != "" {
		wantName = env["OTEL_SERVICE_NAME"]
	}
	if cfg.OTelName != wantName {
		t.Errorf("OTelName = %q, want %q", cfg.OTelName, wantName)
	}
	wantVersion := "dev"
	if env["OTEL_SERVICE_VERSION"] != "" {
		wantVersion = env["OTEL_SERVICE_VERSION"]
	}
	if cfg.OTelVersion != wantVersion {
		t.Errorf("OTelVersion = %q, want %q", cfg.OTelVersion, wantVersion)
	}
	wantRatio := 1.0
	if env["OTEL_TRACE_SAMPLE_RATIO"] != "" {
		wantRatio, _ = strconv.ParseFloat(env["OTEL_TRACE_SAMPLE_RATIO"], 64)
	}
	if cfg.OTelSampleRatio != wantRatio {
		t.Errorf("OTelSampleRatio = %v, want %v", cfg.OTelSampleRatio, wantRatio)
	}
}
