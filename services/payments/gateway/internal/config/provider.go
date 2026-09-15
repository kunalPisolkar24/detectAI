package config

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"strings"

	"github.com/joho/godotenv"
)

type Provider interface {
	Load(ctx context.Context) (*Config, error)
}

func Load(ctx context.Context) (*Config, error) {
	return NewChainProvider().Load(ctx)
}

func NewChainProvider() Provider {
	return &ChainProvider{}
}

type ChainProvider struct{}

func (p *ChainProvider) Load(ctx context.Context) (*Config, error) {
	envType := resolveEnvType()
	if envType != "dev" && envType != "prod" {
		return nil, fmt.Errorf("ENV_TYPE must be dev or prod, got %q", envType)
	}

	cfg := &Config{
		EnvType:   envType,
		AWSRegion: envOr("AWS_REGION", ""),
	}

	if cfg.IsDev() {
		if _, err := os.Stat(".env"); err == nil {
			_ = godotenv.Load()
		} else if v := os.Getenv("ENV_FILE"); v != "" {
			_ = godotenv.Load(v)
		}
		loadFromEnv(cfg)
		applyDevDefaults(cfg)
	} else {
		if err := loadFromAWS(ctx, cfg); err != nil {
			return nil, err
		}
		loadProdNonSecretOverrides(cfg)
	}

	if err := cfg.Validate(); err != nil {
		return nil, err
	}
	if cfg.IsProd() {
		if err := validateProdStrict(cfg); err != nil {
			return nil, err
		}
	}
	return cfg, nil
}

func resolveEnvType() string {
	if v := strings.ToLower(strings.TrimSpace(os.Getenv("ENV_TYPE"))); v != "" {
		return v
	}
	if v := strings.ToLower(strings.TrimSpace(os.Getenv("CONFIG_SOURCE"))); v != "" {
		slog.Warn("CONFIG_SOURCE is deprecated, use ENV_TYPE=dev|prod", "value", v)
		switch v {
		case "aws", "prod":
			return "prod"
		case "env", "dev":
			return "dev"
		default:
			return v
		}
	}
	return "dev"
}

func applyDevDefaults(cfg *Config) {
	if cfg.RabbitMQURL == "" {
		cfg.RabbitMQURL = "amqp://guest:guest@rabbitmq:5672/"
	}
	if cfg.RabbitMQQueueType == "" {
		cfg.RabbitMQQueueType = "quorum"
	}
	if cfg.Port == "" {
		cfg.Port = "8080"
	}
	if cfg.GinMode == "" {
		cfg.GinMode = envOr("GIN_MODE", "release")
	}
	if cfg.LogLevel == "" {
		cfg.LogLevel = envOr("LOG_LEVEL", "info")
	}
	if cfg.OtelServiceName == "" {
		cfg.OtelServiceName = envOr("OTEL_SERVICE_NAME", "payment-gateway")
	}
	if cfg.AWSRegion == "" {
		cfg.AWSRegion = envOr("AWS_REGION", "ap-south-1")
	}
}

func loadProdNonSecretOverrides(cfg *Config) {
	if v := os.Getenv("PORT"); v != "" {
		cfg.Port = v
	} else if cfg.Port == "" {
		if v := os.Getenv("SSM_PREFIX"); v == "" {
			cfg.Port = "8080"
		}
	}
	if v := os.Getenv("GIN_MODE"); v != "" {
		cfg.GinMode = v
	} else if cfg.GinMode == "" {
		cfg.GinMode = "release"
	}
	if v := os.Getenv("LOG_LEVEL"); v != "" {
		cfg.LogLevel = v
	} else if cfg.LogLevel == "" {
		cfg.LogLevel = "info"
	}
	if v := os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT"); v != "" {
		cfg.OtelEndpoint = v
	}
	if v := os.Getenv("OTEL_SERVICE_NAME"); v != "" {
		cfg.OtelServiceName = v
	} else if cfg.OtelServiceName == "" {
		cfg.OtelServiceName = "payment-gateway"
	}
	if cfg.AWSRegion == "" {
		cfg.AWSRegion = envOr("AWS_REGION", "ap-south-1")
	}
}

func validateProdStrict(cfg *Config) error {
	if cfg.AWSRegion == "" {
		return fmt.Errorf("ENV_TYPE=prod requires AWS_REGION")
	}
	if cfg.WebhookSecret == "" || cfg.InternalAPIKey == "" || cfg.RabbitMQURL == "" {
		return fmt.Errorf("ENV_TYPE=prod requires secrets from AWS (detectai/mq/urls + detectai/gateway/secrets) or SSM; missing %s", missingProdKeys(cfg))
	}
	if isDefaultRabbitURL(cfg.RabbitMQURL) {
		return fmt.Errorf("ENV_TYPE=prod must not use default dev RabbitMQ URL")
	}
	return nil
}

func missingProdKeys(cfg *Config) string {
	var miss []string
	if cfg.WebhookSecret == "" {
		miss = append(miss, "PADDLE_WEBHOOK_SECRET")
	}
	if cfg.InternalAPIKey == "" {
		miss = append(miss, "INTERNAL_API_KEY")
	}
	if cfg.RabbitMQURL == "" {
		miss = append(miss, "RABBITMQ_URL")
	}
	return strings.Join(miss, ", ")
}

func isDefaultRabbitURL(raw string) bool {
	return strings.Contains(raw, "guest:guest@rabbitmq:5672")
}

func loadFromEnv(cfg *Config) {
	if v := os.Getenv("RABBITMQ_URL"); v != "" {
		cfg.RabbitMQURL = v
	}
	if v := os.Getenv("RABBITMQ_QUEUE_TYPE"); v != "" {
		cfg.RabbitMQQueueType = v
	}
	if v := os.Getenv("PADDLE_WEBHOOK_SECRET"); v != "" {
		cfg.WebhookSecret = v
	}
	if v := os.Getenv("INTERNAL_API_KEY"); v != "" {
		cfg.InternalAPIKey = v
	}
	if v := os.Getenv("PORT"); v != "" {
		cfg.Port = v
	}
	if v := os.Getenv("GIN_MODE"); v != "" {
		cfg.GinMode = v
	}
	if v := os.Getenv("LOG_LEVEL"); v != "" {
		cfg.LogLevel = v
	}
	if v := os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT"); v != "" {
		cfg.OtelEndpoint = v
	}
	if v := os.Getenv("OTEL_SERVICE_NAME"); v != "" {
		cfg.OtelServiceName = v
	}
	if v := os.Getenv("AWS_REGION"); v != "" {
		cfg.AWSRegion = v
	}
}

func envOr(key, fallback string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return fallback
}
