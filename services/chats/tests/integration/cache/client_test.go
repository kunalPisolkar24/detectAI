// Package cache_test drives the cache plane against a container-backed redis.
package cache_test

import (
	"context"
	"testing"
	"time"

	chatscache "github.com/kunalPisolkar24/detectAI/services/chats/internal/cache"
	"github.com/kunalPisolkar24/detectAI/services/chats/tests/integration/support"
)

func TestMain(m *testing.M) {
	support.Main(m)
}

func TestConnectPingsAndDisconnects(t *testing.T) {
	client := connectContainer(t)

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

	client, err := chatscache.Connect(ctx, "redis://127.0.0.1:1", "")
	if err == nil {
		_ = client.Disconnect(context.Background())
		t.Fatal("Connect = nil error, want a failure against a closed port")
	}
}

// connectContainer dials the client against the package's redis container.
func connectContainer(t *testing.T) *chatscache.Client {
	t.Helper()
	endpoint := support.Redis(t).Endpoint
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	client, err := chatscache.Connect(ctx, endpoint, "")
	if err != nil {
		t.Fatalf("Connect: %v", err)
	}
	t.Cleanup(func() {
		disCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = client.Disconnect(disCtx)
	})
	return client
}
