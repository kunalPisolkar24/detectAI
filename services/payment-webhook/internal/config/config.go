package config

import (
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// Config is the typed boot contract; plane keys without a field are ignored.
type Config struct {
	Port            int
	DrainTimeout    time.Duration
	PaddleSecret    string
	MaxBodyBytes    int64
	QueueURL        string
	PublishBudget   time.Duration
	OTelEndpoint    string
	NewRelicKey     string
	OTelName        string
	OTelVersion     string
	OTelSampleRatio float64
}

const (
	defaultPort        = 8080
	defaultDrain       = 10 * time.Second
	defaultBodyBound   = int64(1 << 20)
	defaultBudget      = 5 * time.Second
	drainSlack         = 5 * time.Second
	minCredentialChars = 16
	defaultOTelName    = "payment-webhook"
	defaultOTelVersion = "dev"
	defaultSampleRatio = 1.0
)

// Resolve reads one plane source: PORT fails the boot on bad values, every other
// field fails closed to its default, and the secret and queue URL are mandatory;
// a set OTel endpoint demands the license key while the sample ratio fails loud.
func Resolve(source Source) (Config, error) {
	cfg := Config{
		Port:            defaultPort,
		DrainTimeout:    defaultDrain,
		MaxBodyBytes:    defaultBodyBound,
		PublishBudget:   defaultBudget,
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
	queueRaw, _ := source.Get("QUEUE_URL")
	queueURL, err := sqsURL(queueRaw)
	if err != nil {
		return Config{}, err
	}
	cfg.QueueURL = queueURL
	if raw, ok := source.Get("PUBLISH_BUDGET"); ok {
		budget, err := time.ParseDuration(strings.TrimSpace(raw))
		if err == nil && budget > 0 {
			cfg.PublishBudget = budget
		}
	}
	// A bad DRAIN_TIMEOUT may not shorten the drain below the publish budget's needs.
	if floor := cfg.PublishBudget + drainSlack; cfg.DrainTimeout < floor {
		cfg.DrainTimeout = floor
	}
	if err := resolveObservability(source, &cfg); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

// resolveObservability reads the NFR-5 keys: the endpoint is the gate — blank
// is a disabled boot — and a set endpoint demands the license key at the
// credential floor; the identity fields fail closed to their defaults while
// the sample ratio fails loud, where document-parser's validator raises too.
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

// sqsURL accepts real SQS and emulator endpoints alike; malformed or missing fails the boot.
func sqsURL(raw string) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	bad := err != nil ||
		(parsed.Scheme != "http" && parsed.Scheme != "https") ||
		parsed.Host == "" ||
		!hasQueueName(parsed.Path)
	if bad {
		return "", fmt.Errorf("config: QUEUE_URL must be an SQS queue URL like https://sqs.<region>.amazonaws.com/<account>/<queue>; got %q", raw)
	}
	return parsed.String(), nil
}

func hasQueueName(path string) bool {
	segments := strings.Split(strings.TrimPrefix(path, "/"), "/")
	if len(segments) < 2 {
		return false
	}
	return segments[0] != "" && segments[len(segments)-1] != ""
}

// credential reads one mandatory secret; failures never echo the attempted value.
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
