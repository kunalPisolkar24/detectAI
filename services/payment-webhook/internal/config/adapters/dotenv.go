// Package adapters holds the plane readers; every adapter parses or fetches once
// at construction and answers pure in-memory lookups afterwards.
package adapters

import "fmt"

// DotEnvAdapter is the dev plane's file reader. Nothing is ever written to
// os.environ: the file is parsed once and the merge with the process environment
// happens in the source.
type DotEnvAdapter struct {
	path   string
	values map[string]string
}

// NewDotEnvAdapter parses one dotenv plane. An empty path targets the
// service-root .env relative to the working directory; a missing default file is
// an empty plane (values come from the process environment alone), while a
// missing explicit path and a malformed file fail the boot loudly. Blank KEY=
// entries drop out, so an empty value can never win over the default.
func NewDotEnvAdapter(path string) (*DotEnvAdapter, error) {
	return nil, fmt.Errorf("config: NewDotEnvAdapter is a skeleton; lands with the dotenv build")
}

// Fetch returns the parsed plane; callers must treat the map as read-only.
func (a *DotEnvAdapter) Fetch() (map[string]string, error) {
	return nil, fmt.Errorf("config: DotEnvAdapter.Fetch is a skeleton; lands with the dotenv build")
}
