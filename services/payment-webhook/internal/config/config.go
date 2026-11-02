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
}

// The field defaults: the identity port and the drain budget — the 5 s publish
// budget plus slack (NFR-9) that bad DRAIN_TIMEOUT values always fail closed to.
const (
	defaultPort  = 8080
	defaultDrain = 10 * time.Second
)

// Resolve reads the declared fields off one plane source: each field is read by
// its env name, and the field's own contract owns its failure behavior. PORT is
// identity — garbage or outside 1–65535 fails the boot naming the var — while
// DRAIN_TIMEOUT fail-closes: missing, blank, unreadable, or ≤ 0 keeps the budget
// default so a bad timeout can never shorten the drain. API_KEY is mandatory in
// every plane: missing or blank fails the boot, and the attempted secret is
// never echoed in the failure (NFR-8).
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
	key, ok := source.Get("API_KEY")
	if !ok || strings.TrimSpace(key) == "" {
		return Config{}, fmt.Errorf("config: API_KEY is mandatory in every plane; export the shared secret before the boot")
	}
	cfg.APIKey = key
	return cfg, nil
}
