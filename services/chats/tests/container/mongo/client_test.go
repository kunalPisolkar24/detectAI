// Package mongo_test drives the database client against the local compose mongo.
package mongo_test

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/db"
)

const testDatabase = "chat_db_test"

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

	client, err := db.Connect(ctx, "mongodb://127.0.0.1:1", testDatabase)
	if err == nil {
		_ = client.Disconnect(context.Background())
		t.Fatal("Connect = nil error, want a failure against a closed port")
	}
}

// connectLocal dials the client or skips when the compose mongo is down.
func connectLocal(t *testing.T) *db.Client {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	client, err := db.Connect(ctx, testURI(t), testDatabase)
	if err != nil {
		t.Skipf("mongo not reachable; run make db-up (or point MONGO_URI elsewhere): %v", err)
	}
	t.Cleanup(func() {
		disCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = client.Disconnect(disCtx)
	})
	return client
}

func testURI(t *testing.T) string {
	t.Helper()
	if uri := os.Getenv("MONGO_URI"); uri != "" {
		return uri
	}
	return "mongodb://localhost:27017"
}
