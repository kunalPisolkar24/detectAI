package adapters

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writePlane(t *testing.T, dir, name, content string) string {
	t.Helper()
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestNewDotEnvAdapterParsesThePlane(t *testing.T) {
	dir := t.TempDir()
	path := writePlane(t, dir, "custom.env", `# a comment

PORT = 9137
DRAIN_TIMEOUT=1500ms
QUEUE_URL=https://x/y?a=b
DROPPED=
# spaced comment
PORT=9138
`)

	adapter, err := NewDotEnvAdapter(path)
	if err != nil {
		t.Fatal(err)
	}
	values := adapter.Fetch()
	if values["PORT"] != "9138" {
		t.Errorf("PORT = %q, want the last assignment 9138", values["PORT"])
	}
	if values["DRAIN_TIMEOUT"] != "1500ms" {
		t.Errorf("DRAIN_TIMEOUT = %q, want 1500ms", values["DRAIN_TIMEOUT"])
	}
	if values["QUEUE_URL"] != "https://x/y?a=b" {
		t.Errorf("QUEUE_URL = %q, want the value after the first = only", values["QUEUE_URL"])
	}
	if _, ok := values["DROPPED"]; ok {
		t.Error("DROPPED kept its blank value; blank entries must drop out")
	}
}

func TestNewDotEnvAdapterMissingDefaultIsEmptyPlane(t *testing.T) {
	t.Chdir(t.TempDir())

	adapter, err := NewDotEnvAdapter("")
	if err != nil {
		t.Fatal(err)
	}
	if len(adapter.Fetch()) != 0 {
		t.Errorf("Fetch = %v, want an empty plane", adapter.Fetch())
	}
}

func TestNewDotEnvAdapterReadsTheDefaultPathFromTheWorkingDirectory(t *testing.T) {
	dir := t.TempDir()
	writePlane(t, dir, ".env", "PORT=9137\n")
	t.Chdir(dir)

	adapter, err := NewDotEnvAdapter("")
	if err != nil {
		t.Fatal(err)
	}
	if got := adapter.Fetch()["PORT"]; got != "9137" {
		t.Errorf("PORT = %q, want 9137 from the default path", got)
	}
}

func TestNewDotEnvAdapterMissingExplicitPathFails(t *testing.T) {
	path := filepath.Join(t.TempDir(), "nope.env")

	_, err := NewDotEnvAdapter(path)
	if err == nil || !strings.Contains(err.Error(), "make env") {
		t.Errorf("err = %v, want an error naming the path and the make env fix", err)
	}
}

func TestNewDotEnvAdapterMalformedPlaneFails(t *testing.T) {
	path := writePlane(t, t.TempDir(), "custom.env", "PORT=8080\ngarbage\n")

	_, err := NewDotEnvAdapter(path)
	if err == nil || !strings.Contains(err.Error(), "line 2") {
		t.Errorf("err = %v, want an error naming line 2", err)
	}
}
