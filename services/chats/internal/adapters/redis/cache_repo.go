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
	// Lua script atomically de-duplicates by message ID, inserts, trims and expires.
	saveToCacheScript = `
local key = KEYS[1]
local newData = ARGV[1]
local newID = ARGV[2]
local score = tonumber(ARGV[3])
local ttl = tonumber(ARGV[4])
local maxSize = tonumber(ARGV[5])
local members = redis.call('ZRANGE', key, 0, -1)
for _, member in ipairs(members) do
  local ok, decoded = pcall(cjson.decode, member)
  if ok and decoded and decoded.id == newID then
    redis.call('ZREM', key, member)
    break
  end
end
redis.call('ZADD', key, score, newData)
redis.call('ZREMRANGEBYRANK', key, 0, -(maxSize+1))
if ttl > 0 then
  redis.call('EXPIRE', key, ttl)
end
return 1
`
)

type CacheRepository struct {
	client redis.UniversalClient
	ttl    time.Duration
}

func NewCacheRepository(client redis.UniversalClient, ttl time.Duration) *CacheRepository {
	if ttl <= 0 {
		ttl = 24 * time.Hour
	}
	return &CacheRepository{
		client: client,
		ttl:    ttl,
	}
}

func cacheKey(chatID string) string {
	return fmt.Sprintf("chat:{%s}:hot", chatID)
}

func scoreFor(t time.Time) float64 {
	if t.IsZero() {
		t = time.Now().UTC()
	}
	return float64(t.Unix()) + float64(t.Nanosecond())/1e9
}

func (r *CacheRepository) SaveToCache(ctx context.Context, msg *domain.Message) error {
	if msg == nil || msg.ChatID == "" || msg.ID == "" {
		return nil
	}
	data, err := json.Marshal(msg)
	if err != nil {
		return err
	}

	key := cacheKey(msg.ChatID)
	ttlSec := int64(r.ttl.Seconds())
	score := scoreFor(msg.CreatedAt)

	res := r.client.Eval(ctx, saveToCacheScript, []string{key}, string(data), msg.ID, fmt.Sprintf("%.9f", score), fmt.Sprintf("%d", ttlSec), fmt.Sprintf("%d", domain.MaxCacheSize))
	if res.Err() == nil {
		return nil
	}
	return r.saveToCacheFallback(ctx, key, data, msg, score, ttlSec)
}

func (r *CacheRepository) saveToCacheFallback(ctx context.Context, key string, data []byte, msg *domain.Message, score float64, ttlSec int64) error {
	existing, err := r.client.ZRange(ctx, key, 0, -1).Result()
	if err != nil && err != redis.Nil {
		return err
	}

	pipe := r.client.Pipeline()

	for _, item := range existing {
		var cached domain.Message
		if err := json.Unmarshal([]byte(item), &cached); err != nil {
			continue
		}
		if cached.ID == msg.ID {
			pipe.ZRem(ctx, key, item)
			break
		}
	}

	pipe.ZAdd(ctx, key, redis.Z{
		Score:  score,
		Member: data,
	})

	pipe.ZRemRangeByRank(ctx, key, 0, -(domain.MaxCacheSize + 1))
	if ttlSec > 0 {
		pipe.Expire(ctx, key, time.Duration(ttlSec)*time.Second)
	}

	_, err = pipe.Exec(ctx)
	return err
}

func (r *CacheRepository) PopulateCache(ctx context.Context, chatID string, messages []*domain.Message) error {
	if len(messages) == 0 || chatID == "" {
		return nil
	}

	key := cacheKey(chatID)

	seen := make(map[string]*domain.Message, len(messages))
	order := make([]string, 0, len(messages))
	for _, m := range messages {
		if m == nil || m.ID == "" {
			continue
		}
		if _, ok := seen[m.ID]; !ok {
			order = append(order, m.ID)
		}
		seen[m.ID] = m
	}
	if len(seen) == 0 {
		return nil
	}

	existing, err := r.client.ZRange(ctx, key, 0, -1).Result()
	if err != nil && err != redis.Nil {
		return err
	}
	existingIDs := make(map[string]string, len(existing))
	for _, item := range existing {
		var cached domain.Message
		if err := json.Unmarshal([]byte(item), &cached); err != nil {
			continue
		}
		if cached.ID != "" {
			existingIDs[cached.ID] = item
		}
	}

	pipe := r.client.Pipeline()
	for _, id := range order {
		msg := seen[id]
		if old, exists := existingIDs[msg.ID]; exists {
			pipe.ZRem(ctx, key, old)
		}
		data, jerr := json.Marshal(msg)
		if jerr != nil {
			continue
		}
		pipe.ZAdd(ctx, key, redis.Z{
			Score:  scoreFor(msg.CreatedAt),
			Member: data,
		})
	}

	pipe.ZRemRangeByRank(ctx, key, 0, -(domain.MaxCacheSize + 1))
	pipe.Expire(ctx, key, r.ttl)

	_, err = pipe.Exec(ctx)
	return err
}

func (r *CacheRepository) GetRecentMessages(ctx context.Context, chatID string) ([]*domain.Message, error) {
	if chatID == "" {
		return nil, nil
	}
	key := cacheKey(chatID)

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
		if msg.ID == "" {
			continue
		}
		messages = append(messages, &msg)
	}

	if len(messages) == 0 {
		return nil, nil
	}
	return messages, nil
}

func (r *CacheRepository) DeleteCache(ctx context.Context, chatID string) error {
	if chatID == "" {
		return nil
	}
	key := cacheKey(chatID)
	return r.client.Del(ctx, key).Err()
}
