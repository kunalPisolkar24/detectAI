// Package db_test drives the database client against a container-backed mongo.
package db_test

import (
	"context"
	"testing"
	"time"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/db"
	"github.com/kunalPisolkar24/detectAI/services/chats/tests/integration/support"
)

const testDatabase = "chat_db_test"

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

	client, err := db.Connect(ctx, "mongodb://127.0.0.1:1", testDatabase)
	if err == nil {
		_ = client.Disconnect(context.Background())
		t.Fatal("Connect = nil error, want a failure against a closed port")
	}
}

// connectContainer dials the client against the package's mongo container.
func connectContainer(t *testing.T) *db.Client {
	t.Helper()
	uri := support.Mongo(t).URI
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	client, err := db.Connect(ctx, uri, testDatabase)
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
