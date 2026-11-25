// Package config resolves the boot config per deployment plane.
package config

import (
	"crypto/ed25519"
	"encoding/base64"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// Config is the typed boot contract; plane keys without a field are ignored.
type Config struct {
	Port            int
	DrainTimeout    time.Duration
	APIKey          string
	DatabaseURL     string
	RedisEndpoint   string
	TokenPrivateKey ed25519.PrivateKey
	AccessTokenTTL  time.Duration
	RefreshTokenTTL time.Duration
}

const (
	defaultPort            = 8090
	defaultDrain           = 5 * time.Second
	minCredentialChars     = 16
	defaultAccessTokenTTL  = 15 * time.Minute
	defaultRefreshTokenTTL = 720 * time.Hour
)

// Resolve reads one plane source: PORT, API_KEY and TOKEN_SIGNING_KEY fail the
// boot, while an unreadable DRAIN_TIMEOUT falls back to the safe default.
func Resolve(source Source) (Config, error) {
	cfg := Config{
		Port:            defaultPort,
		DrainTimeout:    defaultDrain,
		AccessTokenTTL:  defaultAccessTokenTTL,
		RefreshTokenTTL: defaultRefreshTokenTTL,
	}
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
	if err := resolveRedis(source, &cfg); err != nil {
		return Config{}, err
	}
	if err := resolveAPIKey(source, &cfg); err != nil {
		return Config{}, err
	}
	if err := resolveTokenSigningKey(source, &cfg); err != nil {
		return Config{}, err
	}
	if err := resolveDuration(source, "ACCESS_TOKEN_TTL", &cfg.AccessTokenTTL); err != nil {
		return Config{}, err
	}
	if err := resolveDuration(source, "REFRESH_TOKEN_TTL", &cfg.RefreshTokenTTL); err != nil {
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

// resolveRedis reads the cache endpoint; serverless enforces TLS in transit
// and carries no password, so a rediss:// endpoint needs no credential.
func resolveRedis(source Source, cfg *Config) error {
	raw, ok := source.Get("REDIS_ENDPOINT")
	if !ok {
		return fmt.Errorf("config: REDIS_ENDPOINT is required; set it in infra/.env (dev) or the SSM plane (prod)")
	}
	endpoint := strings.TrimSpace(raw)
	if !redisEndpointShaped(endpoint) {
		return fmt.Errorf("config: REDIS_ENDPOINT must be a redis:// or rediss:// endpoint")
	}
	cfg.RedisEndpoint = endpoint
	return nil
}

func redisEndpointShaped(endpoint string) bool {
	return strings.HasPrefix(endpoint, "redis://") || strings.HasPrefix(endpoint, "rediss://")
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

// resolveTokenSigningKey reads the base64url Ed25519 seed; both token keys are
// derived from it so no public key material has to be provisioned separately.
func resolveTokenSigningKey(source Source, cfg *Config) error {
	raw, ok := source.Get("TOKEN_SIGNING_KEY")
	if !ok {
		return fmt.Errorf("config: TOKEN_SIGNING_KEY is required; set it in infra/.env (dev) or the secrets plane (prod)")
	}
	seed, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(raw))
	if err != nil || len(seed) != ed25519.SeedSize {
		return fmt.Errorf("config: TOKEN_SIGNING_KEY must be a base64url-encoded %d-byte seed", ed25519.SeedSize)
	}
	cfg.TokenPrivateKey = ed25519.NewKeyFromSeed(seed)
	return nil
}

func resolveDuration(source Source, key string, target *time.Duration) error {
	raw, ok := source.Get(key)
	if !ok {
		return nil
	}
	value, err := time.ParseDuration(strings.TrimSpace(raw))
	if err != nil || value <= 0 {
		return fmt.Errorf("config: %s must be a positive Go duration; got %q", key, raw)
	}
	*target = value
	return nil
}
