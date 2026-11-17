package db_test

import (
	"context"
	"testing"
	"time"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/db"
)

func TestConnectWithRetryStopsAtTheCallerBudget(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()

	start := time.Now()
	_, err := db.ConnectWithRetry(ctx, "mongodb://127.0.0.1:1", "chats", 10*time.Millisecond)
	if err == nil {
		t.Fatal("ConnectWithRetry = nil error, want the unreachable endpoint to fail")
	}
	if elapsed := time.Since(start); elapsed > 2*time.Second {
		t.Errorf("ConnectWithRetry took %v, want the caller's budget to bound it", elapsed)
	}
}
