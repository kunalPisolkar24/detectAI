// Package factories selects and wires each config plane: the flick picks the
// plane, the factories construct the adapters, and the plane sources are
// composed in planes.
package factories

import (
	"fmt"
	"os"

	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/config/adapters"
	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/config/planes"
)

// ConfigFactory assembles the source for the plane the ENV_TYPE flick selects.
type ConfigFactory struct{}

// Create builds the plane source for a flick; a known flick always yields a plane
// and unknown flicks never reach this far.
func (ConfigFactory) Create(flick string) (planes.Source, error) {
	switch flick {
	case "dev":
		dotenv, err := adapters.NewDotEnvAdapter("")
		if err != nil {
			return nil, err
		}
		return planes.NewDevSource(dotenv, os.Environ())
	case "prod":
		return nil, fmt.Errorf("config: the prod plane refuses before the AWS build; there is no env-file fallback")
	default:
		return nil, fmt.Errorf("config: unknown flick %q reached the factory", flick)
	}
}
