package cache_test

import (
	"testing"

	"github.com/google/uuid"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/cache/keys"
)

func TestNegativeMarkerRoundTripsWithItsTTL(t *testing.T) {
	entries := newEntries(t)
	ctx := testContext(t)
	owner, chatID := uuid.NewString(), uuid.NewString()

	missing, err := entries.Missing(ctx, owner, chatID)
	if err != nil || missing {
		t.Fatalf("Missing = (%v, %v), want a miss", missing, err)
	}
	if err := entries.MarkMissing(ctx, owner, chatID); err != nil {
		t.Fatalf("MarkMissing: %v", err)
	}
	missing, err = entries.Missing(ctx, owner, chatID)
	if err != nil || !missing {
		t.Fatalf("Missing = (%v, %v), want the marker", missing, err)
	}

	key := keys.MissKey(keys.ChatLookupResource(owner, chatID))
	ttl := rawClient(t).TTL(ctx, key).Val()
	if ttl <= 0 || ttl > keys.NegativeTTL {
		t.Errorf("ttl = %v, want a live marker inside %v", ttl, keys.NegativeTTL)
	}

	if err := entries.ClearMissing(ctx, owner, chatID); err != nil {
		t.Fatalf("ClearMissing: %v", err)
	}
	missing, err = entries.Missing(ctx, owner, chatID)
	if err != nil || missing {
		t.Errorf("Missing after clear = (%v, %v), want a miss", missing, err)
	}
}

func TestNegativeMarkersAreOwnerScoped(t *testing.T) {
	entries := newEntries(t)
	ctx := testContext(t)
	chatID := uuid.NewString()
	owner, other := uuid.NewString(), uuid.NewString()

	if err := entries.MarkMissing(ctx, owner, chatID); err != nil {
		t.Fatalf("MarkMissing: %v", err)
	}
	missing, err := entries.Missing(ctx, other, chatID)
	if err != nil {
		t.Fatalf("Missing: %v", err)
	}
	if missing {
		t.Error("a marker for one owner answered for another")
	}
	missing, err = entries.Missing(ctx, owner, chatID)
	if err != nil || !missing {
		t.Errorf("Missing for the owner = (%v, %v), want the marker", missing, err)
	}
}
