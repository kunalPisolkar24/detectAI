package cache_test

import (
	"context"
	"testing"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/cache"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/models"
)

func TestNullCacheAlwaysMisses(t *testing.T) {
	ctx := context.Background()
	var entries cache.Cache = cache.NullCache{}

	if chat, found, err := entries.Chat(ctx, "chat-1"); err != nil || found || chat.ID != "" {
		t.Errorf("Chat = (%+v, %v, %v), want an empty miss", chat, found, err)
	}
	if chats, found, err := entries.ChatList(ctx, "owner-1"); err != nil || found || chats != nil {
		t.Errorf("ChatList = (%+v, %v, %v), want an empty miss", chats, found, err)
	}
	if page, found, err := entries.Head(ctx, "chat-1"); err != nil || found || page.NextCursor != "" {
		t.Errorf("Head = (%+v, %v, %v), want an empty miss", page, found, err)
	}
}

func TestNullCacheDiscardsWrites(t *testing.T) {
	ctx := context.Background()
	var entries cache.Cache = cache.NullCache{}

	if err := entries.PutChat(ctx, models.Chat{ID: "chat-1"}); err != nil {
		t.Errorf("PutChat: %v", err)
	}
	if err := entries.PutChatList(ctx, "owner-1", []models.ChatSummary{}); err != nil {
		t.Errorf("PutChatList: %v", err)
	}
	if err := entries.PutHead(ctx, "chat-1", models.Page{}); err != nil {
		t.Errorf("PutHead: %v", err)
	}
	if err := entries.InvalidateMeta(ctx, "chat-1"); err != nil {
		t.Errorf("InvalidateMeta: %v", err)
	}
	if err := entries.InvalidateChat(ctx, "chat-1"); err != nil {
		t.Errorf("InvalidateChat: %v", err)
	}
	if err := entries.InvalidateOwner(ctx, "owner-1"); err != nil {
		t.Errorf("InvalidateOwner: %v", err)
	}
}

func TestNullLimiterAllowsEveryCall(t *testing.T) {
	var limiter cache.Limiter = cache.NullLimiter{}

	decision, err := limiter.Consume(context.Background(), "owner-1", "create", 7)
	if err != nil {
		t.Fatalf("Consume: %v", err)
	}
	if !decision.Allowed {
		t.Error("Allowed = false, want every call allowed when the cache plane is down")
	}
	if decision.Limit != 7 {
		t.Errorf("Limit = %d, want 7", decision.Limit)
	}
}
