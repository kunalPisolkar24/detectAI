package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math/rand/v2"
	"time"

	driver "github.com/redis/go-redis/v9"

	"github.com/kunalPisolkar24/detectAI/services/users/internal/cache/client"
)

const ttlJitterPercent = 15

type Redis struct {
	client *driver.Client
}

var _ Store = (*Redis)(nil)

func NewRedis(client *client.Client) *Redis {
	return &Redis{client: client.Raw()}
}

func (s *Redis) Get(ctx context.Context, key string, into any) (bool, error) {
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

func (s *Redis) Set(ctx context.Context, key string, value any, ttl time.Duration) error {
	payload, err := json.Marshal(value)
	if err != nil {
		return fmt.Errorf("cache: encode %s: %w", key, err)
	}
	if err := s.client.Set(ctx, key, payload, jitteredTTL(ttl)).Err(); err != nil {
		return fmt.Errorf("cache: set %s: %w", key, err)
	}
	return nil
}

func jitteredTTL(ttl time.Duration) time.Duration {
	if ttl <= 0 {
		return ttl
	}
	spread := int64(ttl) * ttlJitterPercent / 100
	if spread <= 0 {
		return ttl
	}
	return ttl + time.Duration(rand.Int64N(spread+1))
}

func (s *Redis) Delete(ctx context.Context, keys ...string) error {
	if len(keys) == 0 {
		return nil
	}
	if err := s.client.Del(ctx, keys...).Err(); err != nil {
		return fmt.Errorf("cache: delete %v: %w", keys, err)
	}
	return nil
}
