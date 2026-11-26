package cache

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	driver "github.com/redis/go-redis/v9"
)

type RedisStore struct {
	client *driver.Client
}

var _ Store = (*RedisStore)(nil)

func NewStore(client *Client) *RedisStore {
	return &RedisStore{client: client.client}
}

func (s *RedisStore) Get(ctx context.Context, key string, into any) (bool, error) {
	payload, err := s.client.Get(ctx, key).Bytes()
	if errors.Is(err, driver.Nil) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("cache: get %s: %w", key, err)
	}
	if err := json.Unmarshal(payload, into); err != nil {
		return false, nil
	}
	return true, nil
}

func (s *RedisStore) Set(ctx context.Context, key string, value any, ttl time.Duration) error {
	payload, err := json.Marshal(value)
	if err != nil {
		return fmt.Errorf("cache: encode %s: %w", key, err)
	}
	if err := s.client.Set(ctx, key, payload, ttl).Err(); err != nil {
		return fmt.Errorf("cache: set %s: %w", key, err)
	}
	return nil
}

func (s *RedisStore) Delete(ctx context.Context, keys ...string) error {
	if len(keys) == 0 {
		return nil
	}
	if err := s.client.Del(ctx, keys...).Err(); err != nil {
		return fmt.Errorf("cache: delete %v: %w", keys, err)
	}
	return nil
}
