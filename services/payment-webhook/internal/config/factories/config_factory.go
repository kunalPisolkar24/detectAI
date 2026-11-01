// Package factories composes each plane source from its adapters.
package factories

import "fmt"

// Source is the plane contract: absence is a normal answer, never an error.
type Source interface {
	Get(key string) (string, bool)
}

// ConfigFactory assembles the source for the plane the ENV_TYPE flick selects.
type ConfigFactory struct{}

// Create builds the plane source for a flick; a known flick always yields a plane
// and unknown flicks never reach this far.
func (ConfigFactory) Create(flick string) (Source, error) {
	return nil, fmt.Errorf("config: ConfigFactory.Create is a skeleton; the wire-up build wires dev over dotenv and the prod refusal")
}
