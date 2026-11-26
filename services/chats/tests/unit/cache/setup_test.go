package cache_test

import (
	"context"
	"testing"
	"time"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/cache/entries"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/cache/limiter"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/cache/lock"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/cache/setup"
)

func TestSetupDegradesWhenRedisIsUnreachable(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	plane, drain := setup.New(ctx, "redis://127.0.0.1:0")
	if _, ok := plane.Entries.(entries.Null); !ok {
		t.Errorf("entries = %T, want entries.Null", plane.Entries)
	}
	if _, ok := plane.Limiter.(limiter.Null); !ok {
		t.Errorf("limiter = %T, want limiter.Null", plane.Limiter)
	}
	if _, ok := plane.Locker.(lock.Null); !ok {
		t.Errorf("locker = %T, want lock.Null", plane.Locker)
	}
	if err := drain(ctx); err != nil {
		t.Errorf("drain: %v", err)
	}
}
