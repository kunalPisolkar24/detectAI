package config

type ConfigError struct {
	cause error
}

func (e *ConfigError) Error() string { return e.cause.Error() }

func (e *ConfigError) Unwrap() error { return e.cause }
