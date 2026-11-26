package lock

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"time"

	driver "github.com/redis/go-redis/v9"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/cache/client"
)

var releaseScript = driver.NewScript(`
if redis.call("GET", KEYS[1]) == ARGV[1] then
    return redis.call("DEL", KEYS[1])
end
return 0
`)

type Redis struct {
	client *driver.Client
}

var _ Locker = (*Redis)(nil)

func NewRedis(client *client.Client) *Redis {
	return &Redis{client: client.Raw()}
}

func (l *Redis) Acquire(ctx context.Context, key string, ttl time.Duration) (string, error) {
	token, err := newToken()
	if err != nil {
		return "", fmt.Errorf("cache: lock token: %w", err)
	}
	acquired, err := l.client.SetNX(ctx, key, token, ttl).Result()
	if err != nil {
		return "", fmt.Errorf("cache: lock %s: %w", key, err)
	}
	if !acquired {
		return "", ErrLockHeld
	}
	return token, nil
}

func (l *Redis) Release(ctx context.Context, key, token string) error {
	if err := releaseScript.Run(ctx, l.client, []string{key}, token).Err(); err != nil {
		return fmt.Errorf("cache: unlock %s: %w", key, err)
	}
	return nil
}

func newToken() (string, error) {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}
