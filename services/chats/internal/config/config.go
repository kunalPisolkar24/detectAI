package config

import (
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/joho/godotenv"
	"github.com/kelseyhightower/envconfig"
)

type Config struct {
	AppEnv               string        `envconfig:"APP_ENV" default:"production"`
	ServiceRole          string        `envconfig:"SERVICE_ROLE" required:"true"`
	GRPCPort             string        `envconfig:"GRPC_PORT" default:":50051"`
	MetricsPort          string        `envconfig:"METRICS_PORT" default:":9091"`
	MongoURI             string        `envconfig:"MONGO_URI" required:"true"`
	MongoDatabase        string        `envconfig:"MONGO_DATABASE" default:"chat_db"`
	MongoMode            string        `envconfig:"MONGO_MODE" default:"standalone"`
	MongoTLSEnabled      bool          `envconfig:"MONGO_TLS_ENABLED" default:"false"`
	MongoTLSCAFile       string        `envconfig:"MONGO_TLS_CA_FILE" default:""`
	MongoMaxPoolSize     uint64        `envconfig:"MONGO_MAX_POOL_SIZE" default:"0"`
	MongoMinPoolSize     uint64        `envconfig:"MONGO_MIN_POOL_SIZE" default:"0"`
	MongoServerTimeout   time.Duration `envconfig:"MONGO_SERVER_SELECTION_TIMEOUT" default:"0s"`
	RedisAddr            string        `envconfig:"CHAT_REDIS_ADDR"`
	RedisURL             string        `envconfig:"REDIS_URL"`
	RedisPassword        string        `envconfig:"REDIS_PASSWORD"`
	RedisTLSEnabled      bool          `envconfig:"REDIS_TLS_ENABLED" default:"false"`
	RedisTLSCAFile       string        `envconfig:"REDIS_TLS_CA_FILE" default:""`
	RedisPoolSize        int           `envconfig:"REDIS_POOL_SIZE" default:"100"`
	BatchSize            int           `envconfig:"BATCH_SIZE" default:"50"`
	StreamPartitionCount int           `envconfig:"STREAM_PARTITION_COUNT" default:"16"`
	CacheTTL             time.Duration `envconfig:"CACHE_TTL" default:"24h"`
}

func Load() (*Config, error) {
	if envFile := os.Getenv("ENV_FILE"); envFile != "" {
		_ = godotenv.Load(envFile)
	}

	var cfg Config
	err := envconfig.Process("", &cfg)
	if err != nil {
		return nil, err
	}

	if strings.TrimSpace(cfg.RedisAddr) == "" {
		cfg.RedisAddr = strings.TrimSpace(cfg.RedisURL)
	}
	cfg.RedisAddr = strings.TrimSpace(cfg.RedisAddr)
	if strings.HasPrefix(strings.ToLower(cfg.RedisAddr), "rediss://") {
		cfg.RedisAddr = cfg.RedisAddr[len("rediss://"):]
		cfg.RedisTLSEnabled = true
	} else if strings.HasPrefix(strings.ToLower(cfg.RedisAddr), "redis://") {
		cfg.RedisAddr = cfg.RedisAddr[len("redis://"):]
	}
	if at := strings.LastIndex(cfg.RedisAddr, "@"); at >= 0 {
		creds := cfg.RedisAddr[:at]
		cfg.RedisAddr = cfg.RedisAddr[at+1:]
		if cfg.RedisPassword == "" {
			if i := strings.LastIndex(creds, ":"); i >= 0 {
				cfg.RedisPassword = creds[i+1:]
			} else {
				cfg.RedisPassword = creds
			}
		}
	}
	if strings.TrimSpace(cfg.RedisAddr) == "" {
		return nil, fmt.Errorf("CHAT_REDIS_ADDR or REDIS_URL is required (host:port)")
	}
	if !strings.Contains(cfg.RedisAddr, ":") {
		return nil, fmt.Errorf("CHAT_REDIS_ADDR must be host:port, got %q", cfg.RedisAddr)
	}

	cfg.ServiceRole = strings.ToLower(strings.TrimSpace(cfg.ServiceRole))
	if cfg.ServiceRole != "api" && cfg.ServiceRole != "worker" {
		return nil, fmt.Errorf("SERVICE_ROLE must be 'api' or 'worker', got %q", cfg.ServiceRole)
	}

	cfg.MongoMode = strings.ToLower(strings.TrimSpace(cfg.MongoMode))
	if cfg.MongoMode == "" {
		cfg.MongoMode = "standalone"
	}
	if cfg.MongoMode != "standalone" && cfg.MongoMode != "sharded" {
		return nil, fmt.Errorf("MONGO_MODE must be 'standalone' or 'sharded', got %q", cfg.MongoMode)
	}
	if cfg.MongoTLSEnabled && cfg.MongoTLSCAFile != "" {
		if _, err := os.Stat(cfg.MongoTLSCAFile); err != nil {
			return nil, fmt.Errorf("MONGO_TLS_CA_FILE not readable %q: %w", cfg.MongoTLSCAFile, err)
		}
	}
	if cfg.MongoMaxPoolSize == 0 {
		if cfg.MongoMode == "sharded" {
			cfg.MongoMaxPoolSize = 20
		} else {
			cfg.MongoMaxPoolSize = 100
		}
	}
	if cfg.MongoMinPoolSize == 0 {
		if cfg.MongoMode == "sharded" {
			cfg.MongoMinPoolSize = 5
		} else {
			cfg.MongoMinPoolSize = 10
		}
	}
	if cfg.MongoServerTimeout == 0 {
		if cfg.MongoMode == "sharded" {
			cfg.MongoServerTimeout = 15 * time.Second
		} else {
			cfg.MongoServerTimeout = 5 * time.Second
		}
	}
	if cfg.MongoMaxPoolSize == 0 || cfg.MongoMaxPoolSize > 500 {
		return nil, fmt.Errorf("MONGO_MAX_POOL_SIZE must be 1..500, got %d", cfg.MongoMaxPoolSize)
	}
	if cfg.MongoMinPoolSize > cfg.MongoMaxPoolSize {
		return nil, fmt.Errorf("MONGO_MIN_POOL_SIZE (%d) must be <= MONGO_MAX_POOL_SIZE (%d)", cfg.MongoMinPoolSize, cfg.MongoMaxPoolSize)
	}

	if cfg.RedisTLSEnabled && cfg.RedisTLSCAFile != "" {
		if _, err := os.Stat(cfg.RedisTLSCAFile); err != nil {
			return nil, fmt.Errorf("REDIS_TLS_CA_FILE not readable %q: %w", cfg.RedisTLSCAFile, err)
		}
	}

	if cfg.RedisPoolSize <= 0 {
		cfg.RedisPoolSize = 100
	}
	if cfg.RedisPoolSize > 500 {
		return nil, fmt.Errorf("REDIS_POOL_SIZE must be <= 500, got %d", cfg.RedisPoolSize)
	}

	if cfg.BatchSize <= 0 {
		cfg.BatchSize = 50
	}
	if cfg.BatchSize > 500 {
		return nil, fmt.Errorf("BATCH_SIZE must be <= 500, got %d", cfg.BatchSize)
	}

	if cfg.StreamPartitionCount <= 0 {
		cfg.StreamPartitionCount = 16
	}
	if cfg.StreamPartitionCount > 128 {
		return nil, fmt.Errorf("STREAM_PARTITION_COUNT must be <= 128, got %d", cfg.StreamPartitionCount)
	}

	if cfg.CacheTTL <= 0 {
		cfg.CacheTTL = 24 * time.Hour
	}

	if cfg.GRPCPort != "" && !isValidPort(cfg.GRPCPort) {
		return nil, fmt.Errorf("GRPC_PORT has invalid format %q", cfg.GRPCPort)
	}
	if cfg.MetricsPort != "" && !isValidPort(cfg.MetricsPort) {
		return nil, fmt.Errorf("METRICS_PORT has invalid format %q", cfg.MetricsPort)
	}

	return &cfg, nil
}

func isValidPort(p string) bool {
	if p == "" {
		return false
	}
	if strings.HasPrefix(p, ":") && len(p) > 1 {
		return true
	}
	if strings.Contains(p, ":") {
		return true
	}
	return false
}
