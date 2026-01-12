package config

import (
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
	RedisClusterAddrs    []string      `envconfig:"REDIS_CLUSTER_ADDRS" required:"true"`
	RedisPassword        string        `envconfig:"REDIS_PASSWORD"`
	RedisPoolSize        int           `envconfig:"REDIS_POOL_SIZE" default:"100"`
	WorkerConcurrency    int           `envconfig:"WORKER_CONCURRENCY" default:"10"`
	BatchSize            int           `envconfig:"BATCH_SIZE" default:"50"`
	StreamPartitionCount int           `envconfig:"STREAM_PARTITION_COUNT" default:"16"`
	CacheTTL             time.Duration `envconfig:"CACHE_TTL" default:"24h"`
}

func Load() (*Config, error) {
	_ = godotenv.Load()

	var cfg Config
	err := envconfig.Process("", &cfg)
	if err != nil {
		return nil, err
	}
	return &cfg, nil
}