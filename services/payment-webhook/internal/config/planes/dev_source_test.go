package planes

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/config/adapters"
)

func readPlane(t *testing.T, dir, content string) *adapters.DotEnvAdapter {
	t.Helper()
	path := filepath.Join(dir, "custom.env")
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	adapter, err := adapters.NewDotEnvAdapter(path)
	if err != nil {
		t.Fatal(err)
	}
	return adapter
}

func TestNewDevSourceEnvWinsOverTheFile(t *testing.T) {
	dotenv := readPlane(t, t.TempDir(), "PORT=9137\nQA=from-file\n")
	environ := []string{"PORT=1001", "EXTRA=x"}

	src, err := NewDevSource(dotenv, environ)
	if err != nil {
		t.Fatal(err)
	}
	if got, _ := src.Get("PORT"); got != "1001" {
		t.Errorf("Get(PORT) = %q, want the environment to win with 1001", got)
	}
	if got, ok := src.Get("QA"); !ok || got != "from-file" {
		t.Errorf("Get(QA) = %q, %v; want the file baseline from-file", got, ok)
	}
	if got, _ := src.Get("EXTRA"); got != "x" {
		t.Errorf("Get(EXTRA) = %q, want x", got)
	}
	if _, ok := src.Get("MISSING"); ok {
		t.Error("Get(MISSING) answered true; absence must be false")
	}
}

func TestNewDevSourceSkipsEnvironEntriesWithoutAKey(t *testing.T) {
	dotenv := readPlane(t, t.TempDir(), "")
	environ := []string{"NOEQUALS", "=novalue", "PORT=1001"}

	src, err := NewDevSource(dotenv, environ)
	if err != nil {
		t.Fatal(err)
	}
	if got, _ := src.Get("PORT"); got != "1001" {
		t.Errorf("Get(PORT) = %q, want 1001", got)
	}
	if _, ok := src.Get("NOEQUALS"); ok {
		t.Error("Get(NOEQUALS) answered true; malformed entries must be skipped")
	}
}

func TestNewDevSourceEmptyEnvValueWinsAsEmpty(t *testing.T) {
	dotenv := readPlane(t, t.TempDir(), "PORT=9137\n")
	environ := []string{"PORT="}

	src, err := NewDevSource(dotenv, environ)
	if err != nil {
		t.Fatal(err)
	}
	got, ok := src.Get("PORT")
	if !ok || got != "" {
		t.Errorf("Get(PORT) = %q, %v; want the empty export to win", got, ok)
	}
}
