package cache_test

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/cache/keys"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/cache/lock"
)

func TestAcquireIsMutuallyExclusive(t *testing.T) {
	client := connectContainer(t)
	locker := lock.NewRedis(client)
	ctx := testContext(t)
	key := keys.LockKey("test:" + uuid.NewString())

	token, err := locker.Acquire(ctx, key, time.Minute)
	if err != nil {
		t.Fatalf("Acquire: %v", err)
	}
	if _, err := locker.Acquire(ctx, key, time.Minute); !errors.Is(err, lock.ErrLockHeld) {
		t.Errorf("second Acquire = %v, want ErrLockHeld", err)
	}
	if err := locker.Release(ctx, key, token); err != nil {
		t.Fatalf("Release: %v", err)
	}
	if token, err := locker.Acquire(ctx, key, time.Minute); err != nil {
		t.Fatalf("Acquire after release: %v", err)
	} else if err := locker.Release(ctx, key, token); err != nil {
		t.Fatalf("Release: %v", err)
	}
}

func TestReleaseOnlyDeletesTheHeldToken(t *testing.T) {
	client := connectContainer(t)
	locker := lock.NewRedis(client)
	ctx := testContext(t)
	key := keys.LockKey("test:" + uuid.NewString())

	token, err := locker.Acquire(ctx, key, time.Minute)
	if err != nil {
		t.Fatalf("Acquire: %v", err)
	}
	if err := locker.Release(ctx, key, "someone-else"); err != nil {
		t.Fatalf("Release with a foreign token: %v", err)
	}
	if client.Raw().Exists(ctx, key).Val() == 0 {
		t.Error("a foreign token deleted the lock")
	}
	if err := locker.Release(ctx, key, token); err != nil {
		t.Fatalf("Release: %v", err)
	}
	if client.Raw().Exists(ctx, key).Val() != 0 {
		t.Error("the lock survived a release with its own token")
	}
}

func TestTheLockCarriesItsTTL(t *testing.T) {
	client := connectContainer(t)
	locker := lock.NewRedis(client)
	ctx := testContext(t)
	key := keys.LockKey("test:" + uuid.NewString())

	token, err := locker.Acquire(ctx, key, 30*time.Second)
	if err != nil {
		t.Fatalf("Acquire: %v", err)
	}
	t.Cleanup(func() { _ = locker.Release(context.Background(), key, token) })

	ttl := client.Raw().TTL(ctx, key).Val()
	if ttl <= 0 || ttl > 30*time.Second {
		t.Errorf("ttl = %v, want a live lock inside 30s", ttl)
	}
}

func TestExecuteSerializesConcurrentFills(t *testing.T) {
	client := connectContainer(t)
	locker := lock.NewRedis(client)
	ctx := context.Background()
	key := keys.LockKey("fill:" + uuid.NewString())

	var fills atomic.Int32
	var filled atomic.Bool
	var wg sync.WaitGroup
	for range 4 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := lock.Execute(ctx, locker, key, lock.NewPolicy(time.Minute), func(context.Context) (int, error) {
				if filled.Load() {
					return 1, nil
				}
				time.Sleep(20 * time.Millisecond)
				fills.Add(1)
				filled.Store(true)
				return 1, nil
			})
			if err != nil {
				t.Errorf("Execute: %v", err)
			}
		}()
	}
	wg.Wait()

	if got := fills.Load(); got != 1 {
		t.Errorf("fills = %d, want exactly one", got)
	}
}

func TestNullLockerAlwaysAcquires(t *testing.T) {
	var locker lock.Locker = lock.Null{}
	token, err := locker.Acquire(context.Background(), "key", time.Second)
	if err != nil || token == "" {
		t.Fatalf("Acquire = (%q, %v), want a token", token, err)
	}
	if err := locker.Release(context.Background(), "key", token); err != nil {
		t.Errorf("Release: %v", err)
	}
}
