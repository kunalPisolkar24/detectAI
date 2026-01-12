package redis

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/core/domain"
	"github.com/redis/go-redis/v9"
)

type CacheRepository struct {
	client *redis.ClusterClient
	ttl    time.Duration
}

func NewCacheRepository(client *redis.ClusterClient, ttl time.Duration) *CacheRepository {
	return &CacheRepository{
		client: client,
		ttl:    ttl,
	}
}

func (r *CacheRepository) SaveToCache(ctx context.Context, msg *domain.Message) error {
	data, err := json.Marshal(msg)
	if err != nil {
		return err
	}

	key := fmt.Sprintf("chat:{%s}:hot", msg.ChatID)

	pipe := r.client.Pipeline()
	pipe.LPush(ctx, key, data)
	pipe.LTrim(ctx, key, 0, 19)
	pipe.Expire(ctx, key, r.ttl)
	_, err = pipe.Exec(ctx)

	return err
}

func (r *CacheRepository) GetRecentMessages(ctx context.Context, chatID string) ([]*domain.Message, error) {
	key := fmt.Sprintf("chat:{%s}:hot", chatID)
	result, err := r.client.LRange(ctx, key, 0, -1).Result()

	if err == redis.Nil || len(result) == 0 {
		return nil, nil
	}

	if err != nil {
		return nil, err
	}

	messages := make([]*domain.Message, 0, len(result))
	for _, item := range result {
		var msg domain.Message
		if err := json.Unmarshal([]byte(item), &msg); err != nil {
			continue
		}
		messages = append(messages, &msg)
	}

	return messages, nil
}