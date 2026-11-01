// Package adapters holds the plane readers; every adapter parses or fetches once
// at construction and answers pure in-memory lookups afterwards.
package adapters

import (
	"fmt"
	"os"
	"strings"
)

const dotenvFix = "create it with make env (copies .env.example) or fix the file"

// DotEnvAdapter is the dev plane's file reader. Nothing is ever written to
// os.environ: the file is parsed once and the merge with the process environment
// happens in the source.
type DotEnvAdapter struct {
	values map[string]string
}

// NewDotEnvAdapter parses one dotenv plane. An empty path targets the
// service-root .env relative to the working directory; a missing default file is
// an empty plane (values come from the process environment alone), while a
// missing explicit path and a malformed file fail the boot loudly. Blank KEY=
// entries drop out, so an empty value can never win over the default.
func NewDotEnvAdapter(path string) (*DotEnvAdapter, error) {
	explicit := path != ""
	if !explicit {
		path = ".env"
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) && !explicit {
			// A container ships no file and receives its values injected;
			// the file plane stays empty and the environment carries config.
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

// Fetch returns the parsed plane; callers must treat the map as read-only.
func (a *DotEnvAdapter) Fetch() map[string]string {
	return a.values
}

// parseDotEnv applies the one plane grammar: blanks and #-comment lines pass,
// KEY=VALUE entries keep their trimmed parts and drop blank values, and any
// other line fails the boot naming the line and the fix. Last assignment wins.
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
