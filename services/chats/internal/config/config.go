package config

import (
	"fmt"
	"os"
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

	return &cfg, nil
}
