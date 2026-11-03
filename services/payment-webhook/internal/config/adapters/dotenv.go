// Package adapters holds the plane readers; each fetches once and serves in-memory lookups.
package adapters

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const dotenvFix = "create it with make env (copies infra/.env.example) or fix the file"

// DotEnvAdapter is the dev plane's file reader. Nothing is ever written to
// os.environ: the file is parsed once and the merge with the process environment
// happens in the source.
type DotEnvAdapter struct {
	values map[string]string
}

// NewDotEnvAdapter parses the dotenv plane; a missing default (infra/.env) is an
// empty plane, while a missing explicit path or malformed file fails the boot.
func NewDotEnvAdapter(path string) (*DotEnvAdapter, error) {
	explicit := path != ""
	if !explicit {
		path = filepath.Join("infra", ".env")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) && !explicit {
			// Containers receive their values injected; the missing file plane stays empty.
			return &DotEnvAdapter{values: map[string]string{}}, nil
		}
		return nil, fmt.Errorf("config: could not read the dotenv plane %q (%v); %s", path, err, dotenvFix)
	}
	values, err := parseDotEnv(raw, path)
	if err != nil {
		return nil, err
	}
	return &DotEnvAdapter{values: values}, nil
}

// Fetch returns the parsed plane; treat the map as read-only.
func (a *DotEnvAdapter) Fetch() map[string]string {
	return a.values
}

// parseDotEnv applies the dotenv grammar; blank values drop and last assignment wins.
func parseDotEnv(raw []byte, path string) (map[string]string, error) {
	values := map[string]string{}
	for i, line := range strings.Split(string(raw), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, found := strings.Cut(line, "=")
		if !found {
			return nil, fmt.Errorf("config: the dotenv plane %q is malformed at line %d: %q is not KEY=VALUE; %s", path, i+1, line, dotenvFix)
		}
		key, value = strings.TrimSpace(key), strings.TrimSpace(value)
		if key == "" || value == "" {
			continue
		}
		values[key] = value
	}
	return values, nil
}
