// Package redis_test drives the cache client against the local compose redis.
package redis_test

import (
	"context"
	"os"
	"testing"
	"time"

	chatsredis "github.com/kunalPisolkar24/detectAI/services/chats/internal/adapters/redis"
)

func TestConnectPingsAndDisconnects(t *testing.T) {
	client := connectLocal(t)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := client.Ping(ctx); err != nil {
		t.Fatalf("Ping: %v", err)
	}
	if err := client.Disconnect(ctx); err != nil {
		t.Fatalf("Disconnect: %v", err)
	}
}

func TestConnectFailsLoudOnUnreachable(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	client, err := chatsredis.Connect(ctx, "redis://127.0.0.1:1", "")
	if err == nil {
		_ = client.Disconnect(context.Background())
		t.Fatal("Connect = nil error, want a failure against a closed port")
	}
}

// connectLocal dials the client or skips when the compose redis is down.
func connectLocal(t *testing.T) *chatsredis.Client {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	client, err := chatsredis.Connect(ctx, testEndpoint(t), "")
	if err != nil {
		t.Skipf("redis not reachable; run make cache-up (or point REDIS_ENDPOINT elsewhere): %v", err)
	}
	t.Cleanup(func() {
		disCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = client.Disconnect(disCtx)
	})
	return client
}

func testEndpoint(t *testing.T) string {
	t.Helper()
	if endpoint := os.Getenv("REDIS_ENDPOINT"); endpoint != "" {
		return endpoint
	}
	return "redis://localhost:6379"
}
