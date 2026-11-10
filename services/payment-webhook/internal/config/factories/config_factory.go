// Package factories selects and wires the config plane sources.
package factories

import (
	"context"
	"fmt"
	"os"

	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/config/adapters"
	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/config/planes"
)

// ConfigFactory assembles the plane source for the selected environment.
type ConfigFactory struct{}

func (ConfigFactory) Create(flick string) (planes.Source, error) {
	switch flick {
	case "dev":
		dotenv, err := adapters.NewDotEnvAdapter("")
		if err != nil {
			return nil, err
		}
		return planes.NewDevSource(dotenv, os.Environ())
	case "prod":
		awsFactory, err := NewAWSClientFactory(context.Background())
		if err != nil {
			return nil, err
		}
		secrets := awsFactory.NewSecretsManagerAdapter()
		return planes.NewProdSource(awsFactory.NewParameterStoreAdapter(), secrets)
	default:
		return nil, fmt.Errorf("config: unknown flick %q reached the factory", flick)
	}
}
