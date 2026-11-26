package cache_test

import (
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/cache/store"
)

func TestSetSpreadsEqualTTLs(t *testing.T) {
	conn := connectContainer(t)
	entries := store.NewRedis(conn)
	raw := rawClient(t)
	ctx := testContext(t)

	const base = time.Hour
	upper := base + base*15/100
	seen := map[time.Duration]bool{}
	for range 12 {
		key := "test:jitter:" + uuid.NewString()
		if err := entries.Set(ctx, key, "value", base); err != nil {
			t.Fatalf("Set: %v", err)
		}
		ttl := raw.TTL(ctx, key).Val()
		if ttl < base-time.Second || ttl > upper {
			t.Errorf("ttl = %v, want it within [%v, %v]", ttl, base-time.Second, upper)
		}
		seen[ttl] = true
	}
	if len(seen) < 2 {
		t.Errorf("ttls = %v, want expiries spread across more than one value", seen)
	}
}

func TestSetPassesThroughTTLsWithNoSpread(t *testing.T) {
	conn := connectContainer(t)
	entries := store.NewRedis(conn)
	raw := rawClient(t)
	ctx := testContext(t)

	key := "test:jitter:none:" + uuid.NewString()
	if err := entries.Set(ctx, key, "value", 0); err != nil {
		t.Fatalf("Set with no expiry: %v", err)
	}
	if ttl := raw.TTL(ctx, key).Val(); ttl != -1 {
		t.Errorf("ttl = %v, want no expiry", ttl)
	}

	if err := entries.Set(ctx, "test:jitter:tiny:"+uuid.NewString(), "value", time.Nanosecond); err != nil {
		t.Errorf("Set with a nanosecond TTL: %v", err)
	}
}
