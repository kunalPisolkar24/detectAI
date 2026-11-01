// Package config resolves the boot config per plane; the model and the LLD live
// in specification/references/config.md.
package config

import "fmt"

// Load resolves the flick, composes the plane source, and resolves the config —
// the composition root's one call.
func Load() (Config, error) {
	return Config{}, skeleton("Load")
}

// DeploymentFlick reads ENV_TYPE and fails closed: only an exact dev or prod
// match is accepted, so a mis-flicked boot never serves.
func DeploymentFlick() (string, error) {
	return "", skeleton("DeploymentFlick")
}

// skeleton marks the not-yet-wired config surface; the message names the build.
func skeleton(what string) error {
	return &ConfigError{cause: fmt.Errorf("config: %s is a skeleton; the wire-up build connects it", what)}
}
