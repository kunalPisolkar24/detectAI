// Package redis_test drives the cache entries surface against the local compose redis.
package redis_test

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	driver "github.com/redis/go-redis/v9"

	chatsredis "github.com/kunalPisolkar24/detectAI/services/chats/internal/adapters/redis"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/cache"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/store"
)

func newEntries(t *testing.T) *chatsredis.Entries {
	t.Helper()
	return chatsredis.NewEntries(connectLocal(t))
}

// rawClient dials redis directly for the assertions the cache surface does not expose.
func rawClient(t *testing.T) *driver.Client {
	t.Helper()
	opts, err := driver.ParseURL(testEndpoint(t))
	if err != nil {
		t.Fatalf("parse endpoint: %v", err)
	}
	client := driver.NewClient(opts)
	t.Cleanup(func() { _ = client.Close() })
	return client
}

func testContext(t *testing.T) context.Context {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	t.Cleanup(cancel)
	return ctx
}

func sampleChat(id, ownerID string) store.Chat {
	return store.Chat{
		ID:        id,
		UserID:    ownerID,
		Title:     "a question about the repo",
		CreatedAt: time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC),
		UpdatedAt: time.Date(2026, 1, 2, 4, 5, 6, 0, time.UTC),
	}
}

func TestChatRoundTrips(t *testing.T) {
	entries := newEntries(t)
	chat := sampleChat(uuid.NewString(), uuid.NewString())

	if err := entries.PutChat(testContext(t), chat); err != nil {
		t.Fatalf("PutChat: %v", err)
	}

	cached, found, err := entries.Chat(testContext(t), chat.ID)
	if err != nil {
		t.Fatalf("Chat: %v", err)
	}
	if !found {
		t.Fatal("found = false, want the cached chat")
	}
	if cached.ID != chat.ID || cached.UserID != chat.UserID || cached.Title != chat.Title {
		t.Errorf("cached chat = %+v, want %+v", cached, chat)
	}
	if !cached.CreatedAt.Equal(chat.CreatedAt) || !cached.UpdatedAt.Equal(chat.UpdatedAt) {
		t.Errorf("cached timestamps = %v/%v, want %v/%v", cached.CreatedAt, cached.UpdatedAt, chat.CreatedAt, chat.UpdatedAt)
	}
}

func TestChatMissesOnAnUnknownID(t *testing.T) {
	entries := newEntries(t)

	chat, found, err := entries.Chat(testContext(t), uuid.NewString())
	if err != nil {
		t.Fatalf("Chat: %v", err)
	}
	if found {
		t.Errorf("found = true, want a miss; chat = %+v", chat)
	}
}

func TestChatTreatsAnUndecodableValueAsAMiss(t *testing.T) {
	entries := newEntries(t)
	chatID := uuid.NewString()
	raw := rawClient(t)

	if err := raw.Set(testContext(t), cache.ChatKey(chatID), "not json", time.Minute).Err(); err != nil {
		t.Fatalf("seed the raw value: %v", err)
	}

	chat, found, err := entries.Chat(testContext(t), chatID)
	if err != nil {
		t.Fatalf("Chat: %v", err)
	}
	if found {
		t.Errorf("found = true, want a miss; chat = %+v", chat)
	}
}

func TestChatListRoundTrips(t *testing.T) {
	entries := newEntries(t)
	ownerID := uuid.NewString()
	chats := []store.ChatSummary{
		{ID: uuid.NewString(), Title: "first", UpdatedAt: time.Date(2026, 1, 2, 3, 0, 0, 0, time.UTC)},
		{ID: uuid.NewString(), Title: "second", UpdatedAt: time.Date(2026, 1, 2, 2, 0, 0, 0, time.UTC)},
	}

	if err := entries.PutChatList(testContext(t), ownerID, chats); err != nil {
		t.Fatalf("PutChatList: %v", err)
	}

	cached, found, err := entries.ChatList(testContext(t), ownerID)
	if err != nil {
		t.Fatalf("ChatList: %v", err)
	}
	if !found {
		t.Fatal("found = false, want the cached list")
	}
	if len(cached) != len(chats) {
		t.Fatalf("cached list = %d chats, want %d", len(cached), len(chats))
	}
	for i, chat := range cached {
		if chat.ID != chats[i].ID || chat.Title != chats[i].Title {
			t.Errorf("chat %d = %+v, want %+v", i, chat, chats[i])
		}
	}
}

func TestChatListRoundTripsAnEmptyList(t *testing.T) {
	entries := newEntries(t)
	ownerID := uuid.NewString()

	if err := entries.PutChatList(testContext(t), ownerID, []store.ChatSummary{}); err != nil {
		t.Fatalf("PutChatList: %v", err)
	}

	cached, found, err := entries.ChatList(testContext(t), ownerID)
	if err != nil {
		t.Fatalf("ChatList: %v", err)
	}
	if !found {
		t.Fatal("found = false, want the cached list")
	}
	if len(cached) != 0 {
		t.Errorf("cached list = %d chats, want 0", len(cached))
	}
}

func TestHeadRoundTripsTheAnalysisPayload(t *testing.T) {
	entries := newEntries(t)
	chatID := uuid.NewString()
	messages := []store.Message{
		{
			ID:        uuid.NewString(),
			ChatID:    chatID,
			Role:      store.RoleUser,
			Content:   "who wrote this",
			CreatedAt: time.Date(2026, 1, 2, 3, 0, 0, 0, time.UTC),
		},
		{
			ID:        uuid.NewString(),
			ChatID:    chatID,
			Role:      store.RoleAssistant,
			CreatedAt: time.Date(2026, 1, 2, 3, 0, 1, 0, time.UTC),
			Analysis: &store.Analysis{
				State:           store.StateCompleted,
				Model:           store.ModelSpark,
				SourceMessageID: "m1",
				Result: &store.AnalysisResult{
					Label:      store.LabelAI,
					Confidence: 0.9,
					Scores:     store.Scores{AI: 0.9, Human: 0.1},
					Raw:        map[string]any{"nested": map[string]any{"score": 0.5}},
				},
			},
		},
	}

	if err := entries.PutHead(testContext(t), chatID, cache.Page{Messages: messages, NextCursor: "next-page"}); err != nil {
		t.Fatalf("PutHead: %v", err)
	}

	cached, found, err := entries.Head(testContext(t), chatID)
	if err != nil {
		t.Fatalf("Head: %v", err)
	}
	if !found {
		t.Fatal("found = false, want the cached head page")
	}
	if cached.NextCursor != "next-page" {
		t.Errorf("next cursor = %q, want %q", cached.NextCursor, "next-page")
	}
	if len(cached.Messages) != len(messages) {
		t.Fatalf("cached head = %d messages, want %d", len(cached.Messages), len(messages))
	}
	if cached.Messages[0].Content != "who wrote this" {
		t.Errorf("content = %q, want %q", cached.Messages[0].Content, "who wrote this")
	}
	analysis := cached.Messages[1].Analysis
	if analysis == nil || analysis.State != store.StateCompleted {
		t.Fatalf("analysis = %+v, want the completed state", analysis)
	}
	if analysis.Result == nil || analysis.Result.Label != store.LabelAI {
		t.Errorf("result = %+v, want the ai verdict", analysis.Result)
	}
	if analysis.Result.Confidence != 0.9 {
		t.Errorf("confidence = %v, want 0.9", analysis.Result.Confidence)
	}
	nested, ok := analysis.Result.Raw["nested"].(map[string]any)
	if !ok {
		t.Fatalf("raw nested = %+v, want a decoded object", analysis.Result.Raw["nested"])
	}
	if nested["score"] != 0.5 {
		t.Errorf("raw score = %v, want 0.5", nested["score"])
	}
}

func TestInvalidateMetaLeavesTheHead(t *testing.T) {
	entries := newEntries(t)
	chatID := uuid.NewString()
	ownerID := uuid.NewString()
	ctx := testContext(t)

	if err := entries.PutChat(ctx, sampleChat(chatID, ownerID)); err != nil {
		t.Fatalf("PutChat: %v", err)
	}
	if err := entries.PutHead(ctx, chatID, cache.Page{}); err != nil {
		t.Fatalf("PutHead: %v", err)
	}

	if err := entries.InvalidateMeta(ctx, chatID); err != nil {
		t.Fatalf("InvalidateMeta: %v", err)
	}

	if _, found, err := entries.Chat(ctx, chatID); err != nil || found {
		t.Errorf("chat found = %v (err %v), want a miss", found, err)
	}
	if _, found, err := entries.Head(ctx, chatID); err != nil || !found {
		t.Errorf("head found = %v (err %v), want the head to survive", found, err)
	}
}

func TestInvalidateChatClearsMetaAndHead(t *testing.T) {
	entries := newEntries(t)
	chatID := uuid.NewString()
	ctx := testContext(t)

	if err := entries.PutChat(ctx, sampleChat(chatID, uuid.NewString())); err != nil {
		t.Fatalf("PutChat: %v", err)
	}
	if err := entries.PutHead(ctx, chatID, cache.Page{}); err != nil {
		t.Fatalf("PutHead: %v", err)
	}

	if err := entries.InvalidateChat(ctx, chatID); err != nil {
		t.Fatalf("InvalidateChat: %v", err)
	}

	if _, found, err := entries.Chat(ctx, chatID); err != nil || found {
		t.Errorf("chat found = %v (err %v), want a miss", found, err)
	}
	if _, found, err := entries.Head(ctx, chatID); err != nil || found {
		t.Errorf("head found = %v (err %v), want a miss", found, err)
	}
}

func TestInvalidateOwnerClearsTheList(t *testing.T) {
	entries := newEntries(t)
	ownerID := uuid.NewString()
	ctx := testContext(t)

	if err := entries.PutChatList(ctx, ownerID, []store.ChatSummary{{ID: uuid.NewString(), Title: "first"}}); err != nil {
		t.Fatalf("PutChatList: %v", err)
	}

	if err := entries.InvalidateOwner(ctx, ownerID); err != nil {
		t.Fatalf("InvalidateOwner: %v", err)
	}

	if _, found, err := entries.ChatList(ctx, ownerID); err != nil || found {
		t.Errorf("list found = %v (err %v), want a miss", found, err)
	}
}

func TestKeysCarryThePrefixAndTTL(t *testing.T) {
	entries := newEntries(t)
	chatID := uuid.NewString()
	ownerID := uuid.NewString()
	raw := rawClient(t)
	ctx := testContext(t)

	if err := entries.PutChat(ctx, sampleChat(chatID, ownerID)); err != nil {
		t.Fatalf("PutChat: %v", err)
	}
	if err := entries.PutHead(ctx, chatID, cache.Page{}); err != nil {
		t.Fatalf("PutHead: %v", err)
	}
	if err := entries.PutChatList(ctx, ownerID, []store.ChatSummary{}); err != nil {
		t.Fatalf("PutChatList: %v", err)
	}

	for key, wantTTL := range map[string]time.Duration{
		cache.ChatKey(chatID):        cache.ChatMetaTTL,
		cache.ChatHeadKey(chatID):    cache.ChatHeadTTL,
		cache.OwnerChatsKey(ownerID): cache.ChatListTTL,
	} {
		if ttl := raw.TTL(ctx, key).Val(); ttl <= 0 || ttl > wantTTL {
			t.Errorf("ttl of %s = %v, want it within (0, %v]", key, ttl, wantTTL)
		}
	}
}
