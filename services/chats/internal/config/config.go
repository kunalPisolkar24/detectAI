package config

import (
	"fmt"
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
}

const (
	defaultPort        = 8090
	defaultDrain       = 10 * time.Second
	minCredentialChars = 16
	defaultOTelName    = "chats"
	defaultOTelVersion = "dev"
	defaultSampleRatio = 1.0
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
	return cfg, nil
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
		if err != nil || ratio <= 0 || ratio > 1 {
			return fmt.Errorf("config: OTEL_TRACE_SAMPLE_RATIO must lie in the interval (0, 1]; got %q", trimmed)
		}
		cfg.OTelSampleRatio = ratio
	}
	return nil
}
