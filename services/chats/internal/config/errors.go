package config

// ConfigError wraps every config failure so the boot reports one typed error.
type ConfigError struct {
	cause error
}

func (e *ConfigError) Error() string { return e.cause.Error() }

func (e *ConfigError) Unwrap() error { return e.cause }
