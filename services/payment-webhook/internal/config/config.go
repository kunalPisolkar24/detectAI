package config

import (
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// Config is the typed boot contract — the single place that talks types, bounds,
// and failure behavior. Fields land when runtime code consumes them
// (consume-first); plane keys without a field are ignored.
type Config struct {
	Port          int
	DrainTimeout  time.Duration
	PaddleSecret  string
	MaxBodyBytes  int64
	QueueURL      string
	PublishBudget time.Duration
}

// The field defaults: the identity port, the drain budget, the 1 MiB body
// bound (NFR-4), and the 5 s publish budget — the drain floor DRAIN_TIMEOUT
// can never fall under once the budget is configurable (NFR-9). Bad bound
// values fail closed to the defaults; garbage PORT values are identity and
// fail loud instead.
const (
	defaultPort        = 8080
	defaultDrain       = 10 * time.Second
	defaultBodyBound   = int64(1 << 20)
	defaultBudget      = 5 * time.Second
	drainSlack         = 5 * time.Second
	minCredentialChars = 16
)

// Resolve reads the declared fields off one plane source: each field is read by
// its env name, and the field's own contract owns its failure behavior. PORT is
// identity — garbage or outside 1–65535 fails the boot naming the var — while
// DRAIN_TIMEOUT fail-closes: missing, blank, unreadable, or ≤ 0 keeps the budget
// default so a bad timeout can never shorten the drain. The webhook secret is
// mandatory in every plane: missing or blank names the var, short names the
// floor, and neither failure echoes the attempt (NFR-8). MAX_BODY_BYTES and
// PUBLISH_BUDGET fail-closed: unreadable or non-positive keeps the 1 MiB bound
// and the 5 s budget. QUEUE_URL is mandatory — a malformed SQS URL fails the
// boot. The drain clamps up to the publish budget plus slack at the end.
func Resolve(source Source) (Config, error) {
	cfg := Config{Port: defaultPort, DrainTimeout: defaultDrain, MaxBodyBytes: defaultBodyBound, PublishBudget: defaultBudget}
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
	// The drain can never be shorter than the budget plus its slack — a bad
	// DRAIN_TIMEOUT may not shorten the drain below what the publish budget
	// needs (NFR-9). The defaults align: 5 s budget + 5 s slack = 10 s drain.
	if floor := cfg.PublishBudget + drainSlack; cfg.DrainTimeout < floor {
		cfg.DrainTimeout = floor
	}
	return cfg, nil
}

// sqsURL validates the QUEUE_URL grammar: http(s), a host, and at least a
// two-segment path (<account>/<queue name>). Real SQS and Floci (emulator)
// endpoints both qualify, so local runs and prod answer the same check. QUEUE_URL is
// mandatory: an empty or malformed URL fails the boot naming the var.
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

// hasQueueName checks the path carries an account segment and a queue name.
func hasQueueName(path string) bool {
	segments := strings.Split(strings.TrimPrefix(path, "/"), "/")
	if len(segments) < 2 {
		return false
	}
	return segments[0] != "" && segments[len(segments)-1] != ""
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
