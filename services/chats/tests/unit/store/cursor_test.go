package store_test

import (
	"encoding/base64"
	"testing"
	"time"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/store"
)

func TestEncodeCursorRoundTrips(t *testing.T) {
	createdAt := time.Date(2026, 1, 2, 3, 4, 5, 6000000, time.UTC)

	cursor, err := store.EncodeCursor("chat-1", createdAt, "m1")
	if err != nil {
		t.Fatalf("EncodeCursor: %v", err)
	}

	key, err := store.DecodeCursor(cursor)
	if err != nil {
		t.Fatalf("DecodeCursor: %v", err)
	}
	if key.ChatID != "chat-1" {
		t.Errorf("chat id = %q, want %q", key.ChatID, "chat-1")
	}
	if key.ID != "m1" {
		t.Errorf("message id = %q, want %q", key.ID, "m1")
	}
	if !key.T.Equal(createdAt) {
		t.Errorf("timestamp = %v, want %v", key.T, createdAt)
	}
}

func TestDecodeCursorRejectsAMalformedCursor(t *testing.T) {
	for name, cursor := range map[string]string{
		"not base64":      "not base64!!",
		"not json":        "bm90IGpzb24",
		"an empty cursor": "",
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := store.DecodeCursor(cursor); err == nil {
				t.Fatalf("DecodeCursor(%q) = nil error, want a failure", cursor)
			}
		})
	}
}

func TestDecodeCursorRejectsAnIncompleteKey(t *testing.T) {
	// A payload that decodes but carries no keyset tuple is not a usable boundary.
	payload := base64.RawURLEncoding.EncodeToString([]byte(`{"chat_id":"chat-1"}`))

	if _, err := store.DecodeCursor(payload); err == nil {
		t.Fatal("DecodeCursor = nil error, want a failure")
	}
}
