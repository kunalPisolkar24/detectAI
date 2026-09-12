package config

import (
	"fmt"
	"net/url"
	"strconv"
	"strings"
)

type Config struct {
	RabbitMQURL       string
	RabbitMQURLs      []string
	RabbitMQQueueType string
	WebhookSecret     string
	InternalAPIKey    string
	Port              string
	GinMode           string
	LogLevel          string
	OtelEndpoint      string
	OtelServiceName   string
	AWSRegion         string
	EnvType           string
}

func (c *Config) IsProd() bool { return c.EnvType == "prod" }
func (c *Config) IsDev() bool  { return c.EnvType == "dev" }

func (c *Config) Validate() error {
	if c.EnvType != "dev" && c.EnvType != "prod" {
		return fmt.Errorf("ENV_TYPE must be dev or prod, got %q", c.EnvType)
	}
	if c.WebhookSecret == "" {
		return fmt.Errorf("PADDLE_WEBHOOK_SECRET is required")
	}
	if len(c.WebhookSecret) < 16 {
		return fmt.Errorf("PADDLE_WEBHOOK_SECRET must be at least 16 characters")
	}
	if c.InternalAPIKey == "" {
		return fmt.Errorf("INTERNAL_API_KEY is required")
	}
	if len(c.InternalAPIKey) < 16 {
		return fmt.Errorf("INTERNAL_API_KEY must be at least 16 characters")
	}
	if c.RabbitMQURL == "" {
		return fmt.Errorf("RABBITMQ_URL is required")
	}
	urls := splitURLs(c.RabbitMQURL)
	if len(urls) == 0 {
		return fmt.Errorf("RABBITMQ_URL is empty")
	}
	for _, u := range urls {
		parsed, err := url.Parse(u)
		if err != nil {
			return fmt.Errorf("invalid RABBITMQ_URL %q: %w", redactURL(u), err)
		}
		if parsed.Scheme != "amqp" && parsed.Scheme != "amqps" {
			return fmt.Errorf("RABBITMQ_URL scheme must be amqp or amqps, got %q", parsed.Scheme)
		}
		if parsed.Host == "" {
			return fmt.Errorf("RABBITMQ_URL missing host: %q", redactURL(u))
		}
	}
	c.RabbitMQURLs = urls

	qt := strings.ToLower(strings.TrimSpace(c.RabbitMQQueueType))
	if qt != "classic" && qt != "quorum" {
		return fmt.Errorf("RABBITMQ_QUEUE_TYPE must be classic or quorum, got %q", c.RabbitMQQueueType)
	}
	c.RabbitMQQueueType = qt

	port, err := strconv.Atoi(c.Port)
	if err != nil || port < 1 || port > 65535 {
		return fmt.Errorf("PORT must be 1-65535, got %q", c.Port)
	}
	c.Port = strconv.Itoa(port)

	if c.GinMode != "" && c.GinMode != "debug" && c.GinMode != "release" && c.GinMode != "test" {
		return fmt.Errorf("GIN_MODE must be debug, release or test, got %q", c.GinMode)
	}
	return nil
}

func splitURLs(raw string) []string {
	parts := strings.Split(raw, ",")
	var out []string
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

func redactURL(raw string) string {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.User == nil {
		return raw
	}
	parsed.User = url.UserPassword(parsed.User.Username(), "***")
	return parsed.String()
}

func RedactedRabbitURL(raw string) string {
	parts := splitURLs(raw)
	for i, p := range parts {
		parts[i] = redactURL(p)
	}
	return strings.Join(parts, ",")
}
