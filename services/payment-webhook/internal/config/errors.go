// Package config's error vocabulary. ConfigError wraps every config-plane
// failure surfaced across the Load boundary so the boot reports one typed error;
// the factories and adapters return plain, descriptive errors and Load wraps.
package config

// ConfigError carries a config-plane failure across the Load boundary.
type ConfigError struct {
	cause error
}

func (e *ConfigError) Error() string { return e.cause.Error() }

// Unwrap lets errors.Is/As decode the cause behind the boundary.
func (e *ConfigError) Unwrap() error { return e.cause }
