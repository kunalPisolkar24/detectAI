package cache_test

import (
	"context"
	"testing"
	"time"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/cache"
)

func TestSetupDegradesWhenRedisIsUnreachable(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	entries, limiter, drain := cache.Setup(ctx, "redis://127.0.0.1:0", "")
	if _, ok := entries.(cache.NullCache); !ok {
		t.Errorf("entries = %T, want cache.NullCache", entries)
	}
	if _, ok := limiter.(cache.NullLimiter); !ok {
		t.Errorf("limiter = %T, want cache.NullLimiter", limiter)
	}
	if err := drain(ctx); err != nil {
		t.Errorf("drain: %v", err)
	}
}
