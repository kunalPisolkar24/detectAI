// Package config resolves the boot config per deployment plane.
package config

import (
	"fmt"
	"os"

	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/config/factories"
)

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

// DeploymentFlick reads ENV_TYPE and fails closed: only dev or prod is accepted.
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
