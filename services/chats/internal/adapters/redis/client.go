package redis

import (
	"context"
	"time"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/config"
	"github.com/redis/go-redis/v9"
)

func NewClient(cfg *config.Config) (redis.UniversalClient, error) {
	options := &redis.UniversalOptions{
		Addrs:        cfg.RedisAddrs,
		Password:     cfg.RedisPassword,
		PoolSize:     cfg.RedisPoolSize,
		MinIdleConns: 10,
		ReadTimeout:  3 * time.Second,
		WriteTimeout: 3 * time.Second,
		ClientName:   "go-chat-service",
	}

	client := redis.NewUniversalClient(options)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := client.Ping(ctx).Err(); err != nil {
		return nil, err
	}

	return client, nil
}
