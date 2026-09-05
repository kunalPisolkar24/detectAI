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
	RedisMode            string        `envconfig:"CHAT_REDIS_MODE" default:"cluster"`
	RedisAddrs           []string      `envconfig:"CHAT_REDIS_ADDRS"`
	LegacyRedisAddrs     []string      `envconfig:"REDIS_CLUSTER_ADDRS"`
	RedisPassword        string        `envconfig:"REDIS_PASSWORD"`
	RedisPoolSize        int           `envconfig:"REDIS_POOL_SIZE" default:"100"`
	WorkerConcurrency    int           `envconfig:"WORKER_CONCURRENCY" default:"10"`
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

	if len(cfg.RedisAddrs) == 0 {
		cfg.RedisAddrs = cfg.LegacyRedisAddrs
	}

	if len(cfg.RedisAddrs) == 0 {
		return nil, fmt.Errorf("CHAT_REDIS_ADDRS is required")
	}

	switch cfg.RedisMode {
	case "standalone":
		cfg.RedisAddrs = []string{cfg.RedisAddrs[0]}
	case "cluster":
	default:
		return nil, fmt.Errorf("unsupported CHAT_REDIS_MODE: %s", cfg.RedisMode)
	}

	// Normalize and validate
	cfg.ServiceRole = strings.ToLower(strings.TrimSpace(cfg.ServiceRole))
	if cfg.ServiceRole != "api" && cfg.ServiceRole != "worker" {
		return nil, fmt.Errorf("SERVICE_ROLE must be 'api' or 'worker', got %q", cfg.ServiceRole)
	}

	if cfg.RedisPoolSize <= 0 {
		cfg.RedisPoolSize = 100
	}
	if cfg.RedisPoolSize > 500 {
		return nil, fmt.Errorf("REDIS_POOL_SIZE must be <= 500, got %d", cfg.RedisPoolSize)
	}

	if cfg.WorkerConcurrency <= 0 {
		cfg.WorkerConcurrency = 10
	}
	if cfg.WorkerConcurrency > 100 {
		return nil, fmt.Errorf("WORKER_CONCURRENCY must be <= 100, got %d", cfg.WorkerConcurrency)
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

	// Validate ports look like ":9090" or "0.0.0.0:9090"
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
	// Allow ":50051"
	if strings.HasPrefix(p, ":") && len(p) > 1 {
		return true
	}
	// Allow "host:port"
	if strings.Contains(p, ":") {
		return true
	}
	return false
}
