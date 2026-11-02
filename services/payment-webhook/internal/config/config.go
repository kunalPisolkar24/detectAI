package config

import (
	"fmt"
	"strconv"
	"strings"
	"time"
)

// Config is the typed boot contract — the single place that talks types, bounds,
// and failure behavior. Fields land when runtime code consumes them
// (consume-first); plane keys without a field are ignored.
type Config struct {
	Port         int
	DrainTimeout time.Duration
	APIKey       string
	PaddleSecret string
	MaxBodyBytes int64
}

// The field defaults: the identity port, the drain budget — the 5 s publish
// budget plus slack (NFR-9) — and the 1 MiB body bound (NFR-4). Bad bound
// values fail closed to the default; garbage PORT values are identity and fail
// loud instead.
const (
	defaultPort        = 8080
	defaultDrain       = 10 * time.Second
	defaultBodyBound   = int64(1 << 20)
	minCredentialChars = 16
)

// Resolve reads the declared fields off one plane source: each field is read by
// its env name, and the field's own contract owns its failure behavior. PORT is
// identity — garbage or outside 1–65535 fails the boot naming the var — while
// DRAIN_TIMEOUT fail-closes: missing, blank, unreadable, or ≤ 0 keeps the budget
// default so a bad timeout can never shorten the drain. The two credentials are
// mandatory in every plane: missing or blank names the var, short names the
// floor, and neither failure echoes the attempt (NFR-8). MAX_BODY_BYTES
// fail-closes: unset, unreadable, or non-positive keeps the 1 MiB bound (NFR-4).
func Resolve(source Source) (Config, error) {
	cfg := Config{Port: defaultPort, DrainTimeout: defaultDrain, MaxBodyBytes: defaultBodyBound}
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
	key, err := credential(source, "API_KEY", "shared secret")
	if err != nil {
		return Config{}, err
	}
	cfg.APIKey = key
	paddle, err := credential(source, "PADDLE_WEBHOOK_SECRET", "webhook secret")
	if err != nil {
		return Config{}, err
	}
	cfg.PaddleSecret = paddle
	if raw, ok := source.Get("MAX_BODY_BYTES"); ok {
		bound, err := strconv.ParseInt(strings.TrimSpace(raw), 10, 64)
		if err == nil && bound > 0 {
			cfg.MaxBodyBytes = bound
		}
	}
	return cfg, nil
}

// credential reads one mandatory secret: missing or blank answers naming the
// var, a short value names the floor, and neither ever echoes the attempt.
func credential(source Source, key, purpose string) (string, error) {
	raw, _ := source.Get(key)
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return "", fmt.Errorf("config: %s is mandatory in every plane; export the %s before the boot", key, purpose)
	}
	if len(trimmed) < minCredentialChars {
		return "", fmt.Errorf("config: %s must be at least %d characters", key, minCredentialChars)
	}
	return trimmed, nil
}
