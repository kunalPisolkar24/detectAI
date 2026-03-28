package redis

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/core/domain"
	"github.com/redis/go-redis/v9"
)

const (
	maxCacheSize = 100
)

type CacheRepository struct {
	client redis.UniversalClient
	ttl    time.Duration
}

func NewCacheRepository(client redis.UniversalClient, ttl time.Duration) *CacheRepository {
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

	pipe.ZAdd(ctx, key, redis.Z{
		Score:  float64(msg.CreatedAt.UnixNano()),
		Member: data,
	})

	pipe.ZRemRangeByRank(ctx, key, 0, -(maxCacheSize + 1))
	pipe.Expire(ctx, key, r.ttl)

	_, err = pipe.Exec(ctx)
	return err
}

func (r *CacheRepository) PopulateCache(ctx context.Context, chatID string, messages []*domain.Message) error {
	if len(messages) == 0 {
		return nil
	}

	key := fmt.Sprintf("chat:{%s}:hot", chatID)
	pipe := r.client.Pipeline()

	for _, msg := range messages {
		data, err := json.Marshal(msg)
		if err != nil {
			continue
		}
		pipe.ZAdd(ctx, key, redis.Z{
			Score:  float64(msg.CreatedAt.UnixNano()),
			Member: data,
		})
	}

	pipe.ZRemRangeByRank(ctx, key, 0, -(maxCacheSize + 1))
	pipe.Expire(ctx, key, r.ttl)

	_, err := pipe.Exec(ctx)
	return err
}

func (r *CacheRepository) GetRecentMessages(ctx context.Context, chatID string) ([]*domain.Message, error) {
	key := fmt.Sprintf("chat:{%s}:hot", chatID)
	
	result, err := r.client.ZRevRange(ctx, key, 0, -1).Result()
	if err != nil {
		if err == redis.Nil {
			return nil, nil
		}
		return nil, err
	}

	if len(result) == 0 {
		return nil, nil
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

func (r *CacheRepository) DeleteCache(ctx context.Context, chatID string) error {
	key := fmt.Sprintf("chat:{%s}:hot", chatID)
	return r.client.Del(ctx, key).Err()
}
