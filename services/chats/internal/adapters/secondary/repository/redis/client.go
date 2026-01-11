package redis

import (
	"context"
	"time"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/config"
	"github.com/redis/go-redis/v9"
)

func NewClusterClient(cfg *config.Config) (*redis.ClusterClient, error) {
	rdb := redis.NewClusterClient(&redis.ClusterOptions{
		Addrs:        cfg.RedisClusterAddrs,
		Password:     cfg.RedisPassword,
		PoolSize:     cfg.RedisPoolSize,
		MinIdleConns: 10,
		ReadTimeout:  3 * time.Second,
		WriteTimeout: 3 * time.Second,
	})

	if err := rdb.Ping(context.Background()).Err(); err != nil {
		return nil, err
	}

	return rdb, nil
}