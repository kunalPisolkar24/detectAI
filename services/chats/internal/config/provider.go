package config

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/joho/godotenv"
)

// Provider loads configuration from env or AWS.
type Provider interface {
	Load(ctx context.Context) (*Config, error)
}

// Load is the convenience entry point, mirroring gateway/provider.go.
func Load(ctx context.Context) (*Config, error) {
	return NewChainProvider().Load(ctx)
}

// NewChainProvider creates a ChainProvider that follows the dev/prod chain
// used by gateway, workers and document-parser.
func NewChainProvider() Provider {
	return &ChainProvider{}
}

// ChainProvider implements Provider.
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
		if err := loadFromEnv(cfg); err != nil {
			return nil, err
		}
		applyDevDefaults(cfg)
	} else {
		if err := loadFromAWS(ctx, cfg); err != nil {
			return nil, err
		}
		if err := loadProdNonSecretOverrides(cfg); err != nil {
			return nil, err
		}
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
	if v := strings.TrimSpace(os.Getenv("ENV_TYPE")); v != "" {
		lower := strings.ToLower(v)
		switch lower {
		case "production":
			return "prod"
		case "development":
			return "dev"
		case "test":
			return "dev"
		}
		return lower
	}
	return "dev"
}

func envOr(key, fallback string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return fallback
}

func applyDevDefaults(cfg *Config) {
	if cfg.MongoURI == "" {
		cfg.MongoURI = "mongodb://mongo-chat:27017"
	}
	if cfg.MongoDatabase == "" {
		cfg.MongoDatabase = "chat_db"
	}
	if cfg.MongoMode == "" {
		cfg.MongoMode = "standalone"
	}
	if cfg.RedisAddr == "" {
		cfg.RedisAddr = "redis-chat:6379"
	}
	if cfg.RedisPassword == "" {
		cfg.RedisPassword = "test_redis_password"
	}
	if cfg.GRPCPort == "" {
		cfg.GRPCPort = ":50051"
	}
	if cfg.MetricsPort == "" {
		cfg.MetricsPort = ":9091"
	}
	if cfg.LogLevel == "" {
		cfg.LogLevel = "info"
	}
	if cfg.OtelServiceName == "" {
		cfg.OtelServiceName = "chat-service"
	}
	if cfg.AWSRegion == "" {
		cfg.AWSRegion = "ap-south-1"
	}
}

func loadProdNonSecretOverrides(cfg *Config) error {
	if v := os.Getenv("SERVICE_ROLE"); v != "" {
		cfg.ServiceRole = strings.ToLower(strings.TrimSpace(v))
	}
	if v := os.Getenv("GRPC_PORT"); v != "" {
		cfg.GRPCPort = strings.TrimSpace(v)
	} else if cfg.GRPCPort == "" {
		cfg.GRPCPort = ":50051"
	}
	if v := os.Getenv("METRICS_PORT"); v != "" {
		cfg.MetricsPort = strings.TrimSpace(v)
	} else if cfg.MetricsPort == "" {
		cfg.MetricsPort = ":9091"
	}
	if v := os.Getenv("MONGO_DATABASE"); v != "" {
		cfg.MongoDatabase = strings.TrimSpace(v)
	}
	if v := os.Getenv("MONGO_MODE"); v != "" {
		cfg.MongoMode = strings.TrimSpace(v)
	}
	if v := os.Getenv("MONGO_TLS_ENABLED"); v != "" {
		b, err := strconv.ParseBool(strings.TrimSpace(v))
		if err != nil {
			return fmt.Errorf("MONGO_TLS_ENABLED must be bool, got %q: %w", v, err)
		}
		cfg.MongoTLSEnabled = b
	}
	if v := os.Getenv("MONGO_TLS_CA_FILE"); v != "" {
		cfg.MongoTLSCAFile = strings.TrimSpace(v)
	}
	if v := os.Getenv("MONGO_MAX_POOL_SIZE"); v != "" {
		u, err := strconv.ParseUint(strings.TrimSpace(v), 10, 64)
		if err != nil {
			return fmt.Errorf("MONGO_MAX_POOL_SIZE must be integer, got %q: %w", v, err)
		}
		cfg.MongoMaxPoolSize = u
	}
	if v := os.Getenv("MONGO_MIN_POOL_SIZE"); v != "" {
		u, err := strconv.ParseUint(strings.TrimSpace(v), 10, 64)
		if err != nil {
			return fmt.Errorf("MONGO_MIN_POOL_SIZE must be integer, got %q: %w", v, err)
		}
		cfg.MongoMinPoolSize = u
	}
	if v := os.Getenv("MONGO_SERVER_SELECTION_TIMEOUT"); v != "" {
		d, err := time.ParseDuration(strings.TrimSpace(v))
		if err != nil {
			return fmt.Errorf("MONGO_SERVER_SELECTION_TIMEOUT must be duration, got %q: %w", v, err)
		}
		cfg.MongoServerTimeout = d
	}
	if v := os.Getenv("REDIS_TLS_CA_FILE"); v != "" {
		cfg.RedisTLSCAFile = strings.TrimSpace(v)
	}
	if v := os.Getenv("REDIS_TLS_ENABLED"); v != "" {
		b, err := strconv.ParseBool(strings.TrimSpace(v))
		if err != nil {
			return fmt.Errorf("REDIS_TLS_ENABLED must be bool, got %q: %w", v, err)
		}
		cfg.RedisTLSEnabled = b
	}
	if v := os.Getenv("REDIS_POOL_SIZE"); v != "" {
		i, err := strconv.Atoi(strings.TrimSpace(v))
		if err != nil {
			return fmt.Errorf("REDIS_POOL_SIZE must be integer, got %q: %w", v, err)
		}
		cfg.RedisPoolSize = i
	}
	if v := os.Getenv("BATCH_SIZE"); v != "" {
		i, err := strconv.Atoi(strings.TrimSpace(v))
		if err != nil {
			return fmt.Errorf("BATCH_SIZE must be integer, got %q: %w", v, err)
		}
		cfg.BatchSize = i
	}
	if v := os.Getenv("STREAM_PARTITION_COUNT"); v != "" {
		i, err := strconv.Atoi(strings.TrimSpace(v))
		if err != nil {
			return fmt.Errorf("STREAM_PARTITION_COUNT must be integer, got %q: %w", v, err)
		}
		cfg.StreamPartitionCount = i
	}
	if v := os.Getenv("CACHE_TTL"); v != "" {
		d, err := time.ParseDuration(strings.TrimSpace(v))
		if err != nil {
			return fmt.Errorf("CACHE_TTL must be duration, got %q: %w", v, err)
		}
		cfg.CacheTTL = d
	}
	if v := os.Getenv("LOG_LEVEL"); v != "" {
		cfg.LogLevel = strings.TrimSpace(v)
	} else if cfg.LogLevel == "" {
		cfg.LogLevel = "info"
	}
	if v := os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT"); v != "" {
		cfg.OtelEndpoint = strings.TrimSpace(v)
	}
	if v := os.Getenv("OTEL_SERVICE_NAME"); v != "" {
		cfg.OtelServiceName = strings.TrimSpace(v)
	} else if cfg.OtelServiceName == "" {
		cfg.OtelServiceName = "chat-service"
	}
	if v := os.Getenv("AWS_REGION"); v != "" {
		cfg.AWSRegion = strings.TrimSpace(v)
	} else if cfg.AWSRegion == "" {
		cfg.AWSRegion = "ap-south-1"
	}
	return nil
}

func validateProdStrict(cfg *Config) error {
	if strings.TrimSpace(cfg.AWSRegion) == "" {
		return fmt.Errorf("ENV_TYPE=prod requires AWS_REGION")
	}
	if strings.TrimSpace(cfg.MongoURI) == "" || strings.TrimSpace(cfg.RedisAddr) == "" {
		return fmt.Errorf("ENV_TYPE=prod requires Mongo and Redis from AWS (detectai/docdb/urls + detectai/redis/chat/urls) or SSM; missing %s", missingProdKeys(cfg))
	}
	if isDefaultMongoURL(cfg.MongoURI) {
		return fmt.Errorf("ENV_TYPE=prod must not use default dev Mongo URL")
	}
	if isDefaultRedisAddr(cfg.RedisAddr) {
		return fmt.Errorf("ENV_TYPE=prod must not use default dev Redis addr")
	}
	return nil
}

func missingProdKeys(cfg *Config) string {
	var miss []string
	if strings.TrimSpace(cfg.MongoURI) == "" {
		miss = append(miss, "MONGO_URI")
	}
	if strings.TrimSpace(cfg.RedisAddr) == "" {
		miss = append(miss, "CHAT_REDIS_ADDR/REDIS_URL")
	}
	if strings.TrimSpace(cfg.AWSRegion) == "" {
		miss = append(miss, "AWS_REGION")
	}
	if len(miss) == 0 {
		return "unknown"
	}
	return strings.Join(miss, ", ")
}

func isDefaultMongoURL(raw string) bool {
	lower := strings.ToLower(raw)
	return strings.Contains(lower, "mongo-chat:27017") ||
		strings.Contains(lower, "localhost:27017") ||
		strings.Contains(lower, "127.0.0.1:27017")
}

func isDefaultRedisAddr(raw string) bool {
	lower := strings.ToLower(raw)
	return strings.Contains(lower, "redis-chat:6379") ||
		strings.Contains(lower, "localhost:6379") ||
		strings.Contains(lower, "127.0.0.1:6379")
}

func loadFromEnv(cfg *Config) error {
	if v := os.Getenv("SERVICE_ROLE"); v != "" {
		cfg.ServiceRole = strings.ToLower(strings.TrimSpace(v))
	}
	if v := os.Getenv("GRPC_PORT"); v != "" {
		cfg.GRPCPort = strings.TrimSpace(v)
	}
	if v := os.Getenv("METRICS_PORT"); v != "" {
		cfg.MetricsPort = strings.TrimSpace(v)
	}
	if v := os.Getenv("MONGO_URI"); v != "" {
		cfg.MongoURI = strings.TrimSpace(v)
	}
	if v := os.Getenv("MONGO_DATABASE"); v != "" {
		cfg.MongoDatabase = strings.TrimSpace(v)
	}
	if v := os.Getenv("MONGO_MODE"); v != "" {
		cfg.MongoMode = strings.TrimSpace(v)
	}
	if v := os.Getenv("MONGO_TLS_ENABLED"); v != "" {
		b, err := strconv.ParseBool(strings.TrimSpace(v))
		if err != nil {
			return fmt.Errorf("MONGO_TLS_ENABLED must be bool, got %q: %w", v, err)
		}
		cfg.MongoTLSEnabled = b
	}
	if v := os.Getenv("MONGO_TLS_CA_FILE"); v != "" {
		cfg.MongoTLSCAFile = strings.TrimSpace(v)
	}
	if v := os.Getenv("MONGO_MAX_POOL_SIZE"); v != "" {
		u, err := strconv.ParseUint(strings.TrimSpace(v), 10, 64)
		if err != nil {
			return fmt.Errorf("MONGO_MAX_POOL_SIZE must be integer, got %q: %w", v, err)
		}
		cfg.MongoMaxPoolSize = u
	}
	if v := os.Getenv("MONGO_MIN_POOL_SIZE"); v != "" {
		u, err := strconv.ParseUint(strings.TrimSpace(v), 10, 64)
		if err != nil {
			return fmt.Errorf("MONGO_MIN_POOL_SIZE must be integer, got %q: %w", v, err)
		}
		cfg.MongoMinPoolSize = u
	}
	if v := os.Getenv("MONGO_SERVER_SELECTION_TIMEOUT"); v != "" {
		d, err := time.ParseDuration(strings.TrimSpace(v))
		if err != nil {
			return fmt.Errorf("MONGO_SERVER_SELECTION_TIMEOUT must be duration, got %q: %w", v, err)
		}
		cfg.MongoServerTimeout = d
	}
	// Redis — REDIS_URL wins over CHAT_REDIS_ADDR, preserving old precedence.
	if v := os.Getenv("REDIS_URL"); v != "" {
		cfg.RedisAddr = strings.TrimSpace(v)
	} else if v := os.Getenv("CHAT_REDIS_ADDR"); v != "" {
		cfg.RedisAddr = strings.TrimSpace(v)
	}
	if v := os.Getenv("REDIS_PASSWORD"); v != "" {
		cfg.RedisPassword = v
	}
	if v := os.Getenv("REDIS_TLS_ENABLED"); v != "" {
		b, err := strconv.ParseBool(strings.TrimSpace(v))
		if err != nil {
			return fmt.Errorf("REDIS_TLS_ENABLED must be bool, got %q: %w", v, err)
		}
		cfg.RedisTLSEnabled = b
	}
	if v := os.Getenv("REDIS_TLS_CA_FILE"); v != "" {
		cfg.RedisTLSCAFile = strings.TrimSpace(v)
	}
	if v := os.Getenv("REDIS_POOL_SIZE"); v != "" {
		i, err := strconv.Atoi(strings.TrimSpace(v))
		if err != nil {
			return fmt.Errorf("REDIS_POOL_SIZE must be integer, got %q: %w", v, err)
		}
		cfg.RedisPoolSize = i
	}
	if v := os.Getenv("BATCH_SIZE"); v != "" {
		i, err := strconv.Atoi(strings.TrimSpace(v))
		if err != nil {
			return fmt.Errorf("BATCH_SIZE must be integer, got %q: %w", v, err)
		}
		cfg.BatchSize = i
	}
	if v := os.Getenv("STREAM_PARTITION_COUNT"); v != "" {
		i, err := strconv.Atoi(strings.TrimSpace(v))
		if err != nil {
			return fmt.Errorf("STREAM_PARTITION_COUNT must be integer, got %q: %w", v, err)
		}
		cfg.StreamPartitionCount = i
	}
	if v := os.Getenv("CACHE_TTL"); v != "" {
		d, err := time.ParseDuration(strings.TrimSpace(v))
		if err != nil {
			return fmt.Errorf("CACHE_TTL must be duration, got %q: %w", v, err)
		}
		cfg.CacheTTL = d
	}
	if v := os.Getenv("LOG_LEVEL"); v != "" {
		cfg.LogLevel = strings.TrimSpace(v)
	}
	if v := os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT"); v != "" {
		cfg.OtelEndpoint = strings.TrimSpace(v)
	}
	if v := os.Getenv("OTEL_SERVICE_NAME"); v != "" {
		cfg.OtelServiceName = strings.TrimSpace(v)
	}
	if v := os.Getenv("AWS_REGION"); v != "" {
		cfg.AWSRegion = strings.TrimSpace(v)
	}
	if cfg.AWSRegion == "" {
		if v := os.Getenv("AWS_REGION"); v != "" {
			cfg.AWSRegion = strings.TrimSpace(v)
		}
	}
	// Warn if deprecated APP_ENV is still set (strict single ENV_TYPE, no alias).
	if v := os.Getenv("APP_ENV"); v != "" {
		slog.Warn("APP_ENV is deprecated, use ENV_TYPE=dev|prod", "value", v)
	}
	return nil
}
