// Package config resolves the boot config per deployment plane.
package config

import (
	"fmt"
	"strconv"
	"strings"
	"time"
)

// Config is the typed boot contract; plane keys without a field are ignored.
type Config struct {
	Port         int
	DrainTimeout time.Duration
	APIKey       string
	DatabaseURL  string
}

const (
	defaultPort        = 8090
	defaultDrain       = 5 * time.Second
	minCredentialChars = 16
)

// Resolve reads one plane source: PORT and API_KEY fail the boot, while an
// unreadable DRAIN_TIMEOUT falls back to the safe default.
func Resolve(source Source) (Config, error) {
	cfg := Config{Port: defaultPort, DrainTimeout: defaultDrain}
	if raw, ok := source.Get("PORT"); ok {
		port, err := strconv.Atoi(strings.TrimSpace(raw))
		if err != nil || port < 1 || port > 65535 {
			return Config{}, fmt.Errorf("config: PORT must be an integer between 1 and 65535; got %q", raw)
		}
		cfg.Port = port
	}
	if raw, ok := source.Get("DRAIN_TIMEOUT"); ok {
		drain, err := time.ParseDuration(strings.TrimSpace(raw))
		if err == nil && drain > 0 {
			cfg.DrainTimeout = drain
		}
	}
	if err := resolveDatabaseURL(source, &cfg); err != nil {
		return Config{}, err
	}
	if err := resolveAPIKey(source, &cfg); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

// resolveDatabaseURL reads the postgres DSN; the URL carries the credentials,
// so an unset or malformed value would leave the service unable to reach its
// store at boot.
func resolveDatabaseURL(source Source, cfg *Config) error {
	raw, ok := source.Get("DATABASE_URL")
	if !ok {
		return fmt.Errorf("config: DATABASE_URL is required; set it in infra/.env (dev) or the secrets plane (prod)")
	}
	dsn := strings.TrimSpace(raw)
	if !databaseURLShaped(dsn) {
		return fmt.Errorf("config: DATABASE_URL must be a postgres:// or postgresql:// URL")
	}
	cfg.DatabaseURL = dsn
	return nil
}

func databaseURLShaped(dsn string) bool {
	return strings.HasPrefix(dsn, "postgres://") || strings.HasPrefix(dsn, "postgresql://")
}

// resolveAPIKey reads the service credential; an unset or short key would
// leave the service unable to authenticate its callers.
func resolveAPIKey(source Source, cfg *Config) error {
	raw, ok := source.Get("API_KEY")
	if !ok {
		return fmt.Errorf("config: API_KEY is required; set it in infra/.env (dev) or the secrets plane (prod)")
	}
	key := strings.TrimSpace(raw)
	if len(key) < minCredentialChars {
		return fmt.Errorf("config: API_KEY must be at least %d characters", minCredentialChars)
	}
	cfg.APIKey = key
	return nil
}
