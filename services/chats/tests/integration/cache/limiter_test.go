package cache_test

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	driver "github.com/redis/go-redis/v9"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/cache/limiter"
)

func newLimiter(t *testing.T) limiter.Limiter {
	t.Helper()
	return limiter.NewRedis(connectContainer(t))
}

func TestConsumeSpendsTheBudgetThenRefuses(t *testing.T) {
	lim := newLimiter(t)
	owner := uuid.NewString()
	ctx := testContext(t)

	for remaining := 1; remaining >= 0; remaining-- {
		decision, err := lim.Consume(ctx, owner, "create", 2)
		if err != nil {
			t.Fatalf("Consume: %v", err)
		}
		if !decision.Allowed {
			t.Fatalf("a call inside the budget was refused, remaining %d", remaining)
		}
		if decision.Remaining != remaining {
			t.Errorf("remaining = %d, want %d", decision.Remaining, remaining)
		}
		if decision.Limit != 2 {
			t.Errorf("limit = %d, want %d", decision.Limit, 2)
		}
	}

	decision, err := lim.Consume(ctx, owner, "create", 2)
	if err != nil {
		t.Fatalf("Consume: %v", err)
	}
	if decision.Allowed {
		t.Error("the call past the budget was allowed, want it refused")
	}
	if decision.Remaining != 0 {
		t.Errorf("remaining = %d, want 0", decision.Remaining)
	}
	if decision.RetryAfter <= 0 || decision.RetryAfter > 30*time.Second {
		t.Errorf("retry after = %v, want one emission interval", decision.RetryAfter)
	}
	if decision.ResetAfter <= 0 || decision.ResetAfter > time.Minute {
		t.Errorf("reset after = %v, want inside the period", decision.ResetAfter)
	}
}

func TestEachOwnerAndScopeHasItsOwnBudget(t *testing.T) {
	lim := newLimiter(t)
	ctx := testContext(t)
	owner := uuid.NewString()
	other := uuid.NewString()

	if _, err := lim.Consume(ctx, owner, "create", 1); err != nil {
		t.Fatalf("Consume: %v", err)
	}
	decision, err := lim.Consume(ctx, owner, "create", 1)
	if err != nil {
		t.Fatalf("Consume: %v", err)
	}
	if decision.Allowed {
		t.Error("the owner's second call was allowed, want it refused")
	}

	decision, err = lim.Consume(ctx, owner, "write", 1)
	if err != nil {
		t.Fatalf("Consume: %v", err)
	}
	if !decision.Allowed {
		t.Error("the write scope was refused, want its own budget")
	}

	decision, err = lim.Consume(ctx, other, "create", 1)
	if err != nil {
		t.Fatalf("Consume: %v", err)
	}
	if !decision.Allowed {
		t.Error("another owner was refused, want its own budget")
	}
}

func TestTheLimitKeyHasABoundedTTL(t *testing.T) {
	lim := newLimiter(t)
	owner := uuid.NewString()
	ctx := testContext(t)

	if _, err := lim.Consume(ctx, owner, "create", 10); err != nil {
		t.Fatalf("Consume: %v", err)
	}

	want := "rate:chats:rate_limit:" + owner + ":create"
	found := scanKeys(t, rawClient(t), "rate:chats:rate_limit:"+owner+":create*")
	if len(found) != 1 || found[0] != want {
		t.Fatalf("limit keys = %v, want exactly %q", found, want)
	}

	ttl := rawClient(t).TTL(ctx, want).Val()
	if ttl <= 0 || ttl > time.Minute+time.Second {
		t.Errorf("ttl = %v, want a lifetime bounded by the period", ttl)
	}
}

func TestTheBudgetRefillsWithoutAWindowBoundary(t *testing.T) {
	lim := newLimiter(t)
	owner := uuid.NewString()
	ctx := testContext(t)
	const budget = 600

	spent := 0
	for ; spent < budget*2; spent++ {
		decision, err := lim.Consume(ctx, owner, "read", budget)
		if err != nil {
			t.Fatalf("Consume: %v", err)
		}
		if !decision.Allowed {
			break
		}
	}
	if spent == budget*2 {
		t.Fatal("the budget was never refused")
	}

	time.Sleep(120 * time.Millisecond)
	decision, err := lim.Consume(ctx, owner, "read", budget)
	if err != nil {
		t.Fatalf("Consume: %v", err)
	}
	if !decision.Allowed {
		t.Error("the budget did not refill after one emission interval")
	}
}

func TestAFaultSurfacesAsAnError(t *testing.T) {
	client := connectContainer(t)
	lim := limiter.NewRedis(client)
	ctx := testContext(t)

	if _, err := lim.Consume(ctx, uuid.NewString(), "create", 10); err != nil {
		t.Fatalf("Consume: %v", err)
	}
	if err := client.Disconnect(ctx); err != nil {
		t.Fatalf("Disconnect: %v", err)
	}

	if _, err := lim.Consume(ctx, uuid.NewString(), "create", 10); err == nil {
		t.Error("Consume over a closed client = nil error, want the fault surfaced")
	}
}

func scanKeys(t *testing.T, client *driver.Client, pattern string) []string {
	t.Helper()
	var keys []string
	var cursor uint64
	for {
		batch, next, err := client.Scan(context.Background(), cursor, pattern, 100).Result()
		if err != nil {
			t.Fatalf("scan %s: %v", pattern, err)
		}
		keys = append(keys, batch...)
		cursor = next
		if cursor == 0 {
			return keys
		}
	}
}
