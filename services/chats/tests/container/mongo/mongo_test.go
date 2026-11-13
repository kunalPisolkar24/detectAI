// Package mongo_test drives the database client against the local compose mongo.
package mongo_test

import (
	"context"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	driver "go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	chatsmongo "github.com/kunalPisolkar24/detectAI/services/chats/internal/repository"
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

// The client connect itself ensures the indexes, and every re-run against the
// persistent dev volume proves the identical create is a server no-op.
func TestConnectEnsuresDataModelIndexes(t *testing.T) {
	connectLocal(t)

	chats := indexKeys(t, "chats")
	if !chats["user_id:1,updated_at:-1"] {
		t.Errorf("chats indexes = %v, want the sidebar index {user_id: 1, updated_at: -1}", chats)
	}
	messages := indexKeys(t, "messages")
	if !messages["chat_id:1,created_at:-1,_id:-1"] {
		t.Errorf("messages indexes = %v, want the history index {chat_id: 1, created_at: -1, _id: -1}", messages)
	}
}

func TestConnectFailsLoudOnUnreachable(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	client, err := chatsmongo.Connect(ctx, "mongodb://127.0.0.1:1", testDatabase)
	if err == nil {
		_ = client.Disconnect(context.Background())
		t.Fatal("Connect = nil error, want a failure against a closed port")
	}
}

// connectLocal dials the client or skips when the compose mongo is down.
func connectLocal(t *testing.T) *chatsmongo.Client {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	client, err := chatsmongo.Connect(ctx, testURI(t), testDatabase)
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

// indexKeys lists one collection's indexes through a raw inspector connection,
// keyed by the "field:direction" signature of each index.
func indexKeys(t *testing.T, collection string) map[string]bool {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	inspector, err := driver.Connect(options.Client().
		ApplyURI(testURI(t)).
		SetConnectTimeout(5 * time.Second).
		SetServerSelectionTimeout(5 * time.Second))
	if err != nil {
		t.Fatalf("inspector connect: %v", err)
	}
	defer func() {
		disCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = inspector.Disconnect(disCtx)
	}()

	cursor, err := inspector.Database(testDatabase).Collection(collection).Indexes().List(ctx)
	if err != nil {
		t.Fatalf("list indexes on %s: %v", collection, err)
	}
	defer cursor.Close(ctx)

	keys := make(map[string]bool)
	for cursor.Next(ctx) {
		var spec bson.D
		if err := cursor.Decode(&spec); err != nil {
			t.Fatalf("decode index spec: %v", err)
		}
		for _, el := range spec {
			if el.Key != "key" {
				continue
			}
			if doc, ok := el.Value.(bson.D); ok {
				keys[keysSignature(doc)] = true
			}
		}
	}
	if err := cursor.Err(); err != nil {
		t.Fatalf("iterate indexes on %s: %v", collection, err)
	}
	return keys
}

func keysSignature(keys bson.D) string {
	parts := make([]string, 0, len(keys))
	for _, el := range keys {
		parts = append(parts, fmt.Sprintf("%s:%v", el.Key, el.Value))
	}
	return strings.Join(parts, ",")
}
