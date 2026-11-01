// Package config resolves the boot config per plane; the model and the LLD live
// in specification/references/config.md.
package config

import (
	"fmt"
	"os"

	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/config/factories"
)

// Load resolves the flick, composes the plane source, and resolves the config —
// the composition root's one call.
func Load() (Config, error) {
	flick, err := DeploymentFlick()
	if err != nil {
		return Config{}, &ConfigError{cause: err}
	}
	source, err := factories.ConfigFactory{}.Create(flick)
	if err != nil {
		return Config{}, &ConfigError{cause: err}
	}
	cfg, err := Resolve(source)
	if err != nil {
		return Config{}, &ConfigError{cause: err}
	}
	return cfg, nil
}

// DeploymentFlick reads ENV_TYPE and fails closed: only an exact dev or prod
// match is accepted, so a mis-flicked boot never serves.
func DeploymentFlick() (string, error) {
	flick := os.Getenv("ENV_TYPE")
	if flick == "" {
		return "", fmt.Errorf(`config: ENV_TYPE is unset; export it to "dev" or "prod" before the boot`)
	}
	if flick != "dev" && flick != "prod" {
		return "", fmt.Errorf(`config: ENV_TYPE %q is not a flick; only exactly "dev" or "prod" serve`, flick)
	}
	return flick, nil
}
