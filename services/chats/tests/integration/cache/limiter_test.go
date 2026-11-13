package cache_test

import (
	"context"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	driver "github.com/redis/go-redis/v9"

	chatscache "github.com/kunalPisolkar24/detectAI/services/chats/internal/cache"
)

func newLimiter(t *testing.T) chatscache.Limiter {
	t.Helper()
	return chatscache.NewLimiter(connectContainer(t))
}

func TestConsumeCountsTowardsTheLimit(t *testing.T) {
	limiter := newLimiter(t)
	owner := uuid.NewString()
	ctx := testContext(t)

	for count := 1; count <= 2; count++ {
		decision, err := limiter.Consume(ctx, owner, "create", 2)
		if err != nil {
			t.Fatalf("Consume: %v", err)
		}
		if !decision.Allowed {
			t.Errorf("call %d was refused, want it allowed", count)
		}
		if decision.Count != count {
			t.Errorf("count = %d, want %d", decision.Count, count)
		}
		if decision.Limit != 2 {
			t.Errorf("limit = %d, want %d", decision.Limit, 2)
		}
	}

	decision, err := limiter.Consume(ctx, owner, "create", 2)
	if err != nil {
		t.Fatalf("Consume: %v", err)
	}
	if decision.Allowed {
		t.Error("the third call was allowed, want it refused")
	}
	if decision.Count != 3 {
		t.Errorf("count = %d, want %d", decision.Count, 3)
	}
	if decision.RetryAfter <= 0 || decision.RetryAfter > chatscache.RateLimitWindow {
		t.Errorf("retry after = %v, want it inside the window", decision.RetryAfter)
	}
}

func TestEachOwnerAndScopeHasItsOwnBudget(t *testing.T) {
	limiter := newLimiter(t)
	ctx := testContext(t)
	owner := uuid.NewString()
	other := uuid.NewString()

	if _, err := limiter.Consume(ctx, owner, "create", 1); err != nil {
		t.Fatalf("Consume: %v", err)
	}
	decision, err := limiter.Consume(ctx, owner, "create", 1)
	if err != nil {
		t.Fatalf("Consume: %v", err)
	}
	if decision.Allowed {
		t.Error("the owner's second call was allowed, want it refused")
	}

	decision, err = limiter.Consume(ctx, owner, "write", 1)
	if err != nil {
		t.Fatalf("Consume: %v", err)
	}
	if !decision.Allowed {
		t.Error("the write scope was refused, want its own budget")
	}

	decision, err = limiter.Consume(ctx, other, "create", 1)
	if err != nil {
		t.Fatalf("Consume: %v", err)
	}
	if !decision.Allowed {
		t.Error("another owner was refused, want its own budget")
	}
}

func TestTheCounterCarriesTheWindowTTL(t *testing.T) {
	limiter := newLimiter(t)
	owner := uuid.NewString()
	ctx := testContext(t)

	if _, err := limiter.Consume(ctx, owner, "create", 10); err != nil {
		t.Fatalf("Consume: %v", err)
	}

	keys := scanKeys(t, rawClient(t), "chats:rate_limit:"+owner+":create:*")
	if len(keys) != 1 {
		t.Fatalf("counter keys = %v, want exactly one", keys)
	}

	ttl := rawClient(t).TTL(ctx, keys[0]).Val()
	if ttl <= 0 {
		t.Errorf("ttl = %v, want a live counter", ttl)
	}
	if ttl > chatscache.RateLimitWindow+chatscache.RateLimitGrace {
		t.Errorf("ttl = %v, want it inside the window and its grace", ttl)
	}
}

func TestTheCounterKeyCarriesTheEpochMinute(t *testing.T) {
	limiter := newLimiter(t)
	owner := uuid.NewString()
	ctx := testContext(t)

	before := time.Now().Unix() / 60
	if _, err := limiter.Consume(ctx, owner, "create", 10); err != nil {
		t.Fatalf("Consume: %v", err)
	}
	after := time.Now().Unix() / 60

	keys := scanKeys(t, rawClient(t), "chats:rate_limit:"+owner+":create:*")
	if len(keys) != 1 {
		t.Fatalf("counter keys = %v, want exactly one", keys)
	}

	windowMinute, err := strconv.ParseInt(keys[0][strings.LastIndex(keys[0], ":")+1:], 10, 64)
	if err != nil {
		t.Fatalf("parse the window id of %q: %v", keys[0], err)
	}
	if windowMinute < before || windowMinute > after {
		t.Errorf("window minute = %d, want it between %d and %d", windowMinute, before, after)
	}
}

func TestTheBudgetIsFreshInTheNextWindow(t *testing.T) {
	limiter := newLimiter(t)
	owner := uuid.NewString()
	ctx := testContext(t)

	previous := time.Now().UTC().Truncate(chatscache.RateLimitWindow).Add(-chatscache.RateLimitWindow)
	previousKey := chatscache.RateLimitKey(owner, "create", previous.Unix()/int64(chatscache.RateLimitWindow/time.Second))
	if err := rawClient(t).Set(ctx, previousKey, 99, time.Minute).Err(); err != nil {
		t.Fatalf("seed the previous window: %v", err)
	}

	decision, err := limiter.Consume(ctx, owner, "create", 10)
	if err != nil {
		t.Fatalf("Consume: %v", err)
	}
	if !decision.Allowed {
		t.Error("the call was refused, want a fresh budget")
	}
	if decision.Count != 1 {
		t.Errorf("count = %d, want %d", decision.Count, 1)
	}
}

func TestAFaultSurfacesAsAnError(t *testing.T) {
	client := connectContainer(t)
	limiter := chatscache.NewLimiter(client)
	ctx := testContext(t)

	if _, err := limiter.Consume(ctx, uuid.NewString(), "create", 10); err != nil {
		t.Fatalf("Consume: %v", err)
	}
	if err := client.Disconnect(ctx); err != nil {
		t.Fatalf("Disconnect: %v", err)
	}

	if _, err := limiter.Consume(ctx, uuid.NewString(), "create", 10); err == nil {
		t.Error("Consume over a closed client = nil error, want the fault surfaced")
	}
}

// scanKeys collects the keys matching a pattern.
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
