// Package config_test covers the config stack black-box from tests/unit,
// mirroring document-parser's tests tree: the sources stay bloat-free and every
// test exercises the exported API.
package config_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/config/adapters"
)

// writePlane writes one file into dir and returns its path.
func writePlane(t *testing.T, dir, name, content string) string {
	t.Helper()
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

// readEnvPlane builds one dotenv adapter over a temp plane file.
func readEnvPlane(t *testing.T, dir, content string) *adapters.DotEnvAdapter {
	t.Helper()
	adapter, err := adapters.NewDotEnvAdapter(writePlane(t, dir, "custom.env", content))
	if err != nil {
		t.Fatal(err)
	}
	return adapter
}
