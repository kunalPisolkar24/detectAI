package cache_test

import (
	"context"
	"testing"
	"time"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/cache/client"
	"github.com/kunalPisolkar24/detectAI/services/chats/tests/integration/support"
)

func TestMain(m *testing.M) {
	support.Main(m)
}

func TestConnectPingsAndDisconnects(t *testing.T) {
	conn := connectContainer(t)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := conn.Ping(ctx); err != nil {
		t.Fatalf("Ping: %v", err)
	}
	if err := conn.Disconnect(ctx); err != nil {
		t.Fatalf("Disconnect: %v", err)
	}
}

func TestConnectFailsLoudOnUnreachable(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	conn, err := client.Connect(ctx, "redis://127.0.0.1:1")
	if err == nil {
		_ = conn.Disconnect(context.Background())
		t.Fatal("Connect = nil error, want a failure against a closed port")
	}
}

func connectContainer(t *testing.T) *client.Client {
	t.Helper()
	endpoint := support.Redis(t).Endpoint
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	conn, err := client.Connect(ctx, endpoint)
	if err != nil {
		t.Fatalf("Connect: %v", err)
	}
	t.Cleanup(func() {
		disCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = conn.Disconnect(disCtx)
	})
	return conn
}
