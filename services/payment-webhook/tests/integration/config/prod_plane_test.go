package config_test

import (
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/config"
)

// The prod plane through the real floci endpoint, driven by the boot path. The
// emulator (and its seeded planes) is environment, not setup: the test skips
// when :4566 is unreachable and asserts the boot against the values that
// `make secrets-auto-apply` seeded from infra/.env.

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
		t.Fatalf("config: the integration test reads infra/.env: %v", err)
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

	if cfg.PaddleSecret != env["PADDLE_WEBHOOK_SECRET"] {
		t.Errorf("PaddleSecret did not come off the seeded secrets blob")
	}
	if cfg.QueueURL != env["QUEUE_URL"] {
		t.Errorf("QueueURL = %q, want the seeded %q", cfg.QueueURL, env["QUEUE_URL"])
	}
	if env["PORT"] != "" {
		if port, _ := strconv.Atoi(env["PORT"]); cfg.Port != port {
			t.Errorf("Port = %d, want the seeded %d", cfg.Port, port)
		}
	}
	if env["MAX_BODY_BYTES"] != "" {
		if bound, _ := strconv.ParseInt(env["MAX_BODY_BYTES"], 10, 64); cfg.MaxBodyBytes != bound {
			t.Errorf("MaxBodyBytes = %d, want the seeded %d", cfg.MaxBodyBytes, bound)
		}
	}
	if env["PUBLISH_BUDGET"] != "" {
		if budget, _ := time.ParseDuration(env["PUBLISH_BUDGET"]); cfg.PublishBudget != budget {
			t.Errorf("PublishBudget = %v, want the seeded %v", cfg.PublishBudget, budget)
		}
	}
}
