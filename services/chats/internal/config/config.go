package config

import (
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"
)

// Config is the typed boot contract; plane keys without a field are ignored.
type Config struct {
	Port            int
	DrainTimeout    time.Duration
	OTelEndpoint    string
	NewRelicKey     string
	OTelName        string
	OTelVersion     string
	OTelSampleRatio float64
	MongoURI        string
	MongoDatabase   string
	RedisEndpoint   string
	RedisAuthToken  string
	APIKey          string

	RateLimitCreateMax int
	RateLimitWriteMax  int
}

const (
	defaultPort        = 8090
	defaultDrain       = 10 * time.Second
	minCredentialChars = 16
	defaultOTelName    = "chats"
	defaultOTelVersion = "dev"
	defaultSampleRatio = 1.0

	defaultMongoDatabase = "chat_db"

	defaultRateLimitCreateMax = 10
	defaultRateLimitWriteMax  = 60
)

// Resolve reads one plane source: numeric bounds fail closed, PORT and the
// OTel gate fail the boot, and a set OTel endpoint demands the license key.
func Resolve(source Source) (Config, error) {
	cfg := Config{
		Port:            defaultPort,
		DrainTimeout:    defaultDrain,
		OTelName:        defaultOTelName,
		OTelVersion:     defaultOTelVersion,
		OTelSampleRatio: defaultSampleRatio,
		MongoDatabase:   defaultMongoDatabase,
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
	if err := resolveObservability(source, &cfg); err != nil {
		return Config{}, err
	}
	if err := resolveMongo(source, &cfg); err != nil {
		return Config{}, err
	}
	if err := resolveRedis(source, &cfg); err != nil {
		return Config{}, err
	}
	if err := resolveAPIKey(source, &cfg); err != nil {
		return Config{}, err
	}
	if err := resolveRateLimits(source, &cfg); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

// resolveRateLimits reads the burst budgets; an unset key takes the
// conservative default and a malformed one fails the boot.
func resolveRateLimits(source Source, cfg *Config) error {
	create, err := resolveRateLimitMax(source, "RATE_LIMIT_CREATE_MAX", defaultRateLimitCreateMax)
	if err != nil {
		return err
	}
	write, err := resolveRateLimitMax(source, "RATE_LIMIT_WRITE_MAX", defaultRateLimitWriteMax)
	if err != nil {
		return err
	}
	cfg.RateLimitCreateMax = create
	cfg.RateLimitWriteMax = write
	return nil
}

// resolveRateLimitMax reads one burst budget; an unset or empty key takes
// the fallback, a malformed one fails the boot.
func resolveRateLimitMax(source Source, key string, fallback int) (int, error) {
	raw, ok := source.Get(key)
	if !ok {
		return fallback, nil
	}
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return fallback, nil
	}
	value, err := strconv.Atoi(trimmed)
	if err != nil || value <= 0 {
		return 0, fmt.Errorf("config: %s must be a positive integer; got %q", key, trimmed)
	}
	return value, nil
}

// resolveAPIKey reads the service credential; API_KEY is required and must
// clear the credential floor, because an unset key would authenticate everyone.
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

// resolveRedis reads the cache keys; REDIS_ENDPOINT is required and a rediss
// endpoint demands REDIS_AUTH_TOKEN at the credential floor.
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
	if raw, ok := source.Get("REDIS_AUTH_TOKEN"); ok {
		if token := strings.TrimSpace(raw); token != "" {
			cfg.RedisAuthToken = token
		}
	}
	if strings.HasPrefix(endpoint, "rediss://") && len(cfg.RedisAuthToken) < minCredentialChars {
		return fmt.Errorf(
			"config: REDIS_ENDPOINT is rediss://, so REDIS_AUTH_TOKEN must be at least %d characters (the ElastiCache AUTH token)",
			minCredentialChars)
	}
	return nil
}

// redisEndpointShaped accepts both driver schemes; deeper validation belongs to the dial.
func redisEndpointShaped(endpoint string) bool {
	return strings.HasPrefix(endpoint, "redis://") || strings.HasPrefix(endpoint, "rediss://")
}

// resolveMongo reads the database keys; MONGO_URI is required and MONGO_DATABASE defaults to chat_db.
func resolveMongo(source Source, cfg *Config) error {
	raw, ok := source.Get("MONGO_URI")
	if !ok {
		return fmt.Errorf("config: MONGO_URI is required; set it in infra/.env (dev) or the secrets plane (prod)")
	}
	uri := strings.TrimSpace(raw)
	if !mongoURIShaped(uri) {
		return fmt.Errorf("config: MONGO_URI must be a mongodb:// or mongodb+srv:// URI")
	}
	cfg.MongoURI = uri
	if raw, ok := source.Get("MONGO_DATABASE"); ok {
		if name := strings.TrimSpace(raw); name != "" {
			cfg.MongoDatabase = name
		}
	}
	return nil
}

// mongoURIShaped accepts both driver schemes; deeper validation belongs to the dial.
func mongoURIShaped(uri string) bool {
	return strings.HasPrefix(uri, "mongodb://") || strings.HasPrefix(uri, "mongodb+srv://")
}

// resolveObservability reads the OTel keys; a set endpoint demands the license key at the credential floor.
func resolveObservability(source Source, cfg *Config) error {
	if raw, ok := source.Get("OTEL_EXPORTER_OTLP_ENDPOINT"); ok {
		endpoint := strings.TrimSpace(raw)
		if endpoint != "" {
			key, _ := source.Get("NEW_RELIC_LICENSE_KEY")
			key = strings.TrimSpace(key)
			if len(key) < minCredentialChars {
				return fmt.Errorf(
					"config: OTEL_EXPORTER_OTLP_ENDPOINT is set, so NEW_RELIC_LICENSE_KEY must be at least %d characters (the ingest license key)",
					minCredentialChars)
			}
			cfg.OTelEndpoint = endpoint
			cfg.NewRelicKey = key
		}
	}
	if raw, ok := source.Get("OTEL_SERVICE_NAME"); ok {
		if name := strings.TrimSpace(raw); name != "" {
			cfg.OTelName = name
		}
	}
	if raw, ok := source.Get("OTEL_SERVICE_VERSION"); ok {
		if version := strings.TrimSpace(raw); version != "" {
			cfg.OTelVersion = version
		}
	}
	if raw, ok := source.Get("OTEL_TRACE_SAMPLE_RATIO"); ok {
		trimmed := strings.TrimSpace(raw)
		ratio, err := strconv.ParseFloat(trimmed, 64)
		// NaN parses cleanly and defeats both bounds checks, so it is refused explicitly.
		if err != nil || math.IsNaN(ratio) || ratio <= 0 || ratio > 1 {
			return fmt.Errorf("config: OTEL_TRACE_SAMPLE_RATIO must lie in the interval (0, 1]; got %q", trimmed)
		}
		cfg.OTelSampleRatio = ratio
	}
	return nil
}
