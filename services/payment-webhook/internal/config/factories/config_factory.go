// Package factories selects and wires each config plane: the flick picks the
// plane, the factories construct the adapters, and the plane sources are
// composed in planes.
package factories

import (
	"fmt"

	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/config/planes"
)

// ConfigFactory assembles the source for the plane the ENV_TYPE flick selects.
type ConfigFactory struct{}

// Create builds the plane source for a flick; a known flick always yields a plane
// and unknown flicks never reach this far.
func (ConfigFactory) Create(flick string) (planes.Source, error) {
	return nil, fmt.Errorf("config: ConfigFactory.Create is a skeleton; the wire-up build wires dev over dotenv and the prod refusal")
}
