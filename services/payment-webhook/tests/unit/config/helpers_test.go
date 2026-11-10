// Package config_test covers the config stack black-box through the exported API.
package config_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/config/adapters"
)

// writePlane writes one file and returns its path, creating intermediate directories.
func writePlane(t *testing.T, dir, name, content string) string {
	t.Helper()
	path := filepath.Join(dir, name)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func readEnvPlane(t *testing.T, dir, content string) *adapters.DotEnvAdapter {
	t.Helper()
	adapter, err := adapters.NewDotEnvAdapter(writePlane(t, dir, "custom.env", content))
	if err != nil {
		t.Fatal(err)
	}
	return adapter
}

// offlineProd pins the SDK's chain away from every real AWS surface: shared config gone, IMDS disabled, static dummies.
func offlineProd(t *testing.T, region string) {
	t.Helper()
	isolated := t.TempDir()
	t.Setenv("AWS_CONFIG_FILE", filepath.Join(isolated, "config"))
	t.Setenv("AWS_SHARED_CREDENTIALS_FILE", filepath.Join(isolated, "credentials"))
	t.Setenv("AWS_EC2_METADATA_DISABLED", "true")
	t.Setenv("AWS_ACCESS_KEY_ID", "x")
	t.Setenv("AWS_SECRET_ACCESS_KEY", "x")
	t.Setenv("AWS_REGION", region)
	t.Setenv("AWS_DEFAULT_REGION", region)
}
