package services_test

import (
	"context"
	"errors"
	"testing"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/models"
)

func TestNotFoundIsServedFromTheNegativeMarker(t *testing.T) {
	calls := 0
	repo := &fakeRepository{chat: func(context.Context, string, string) (models.Chat, error) {
		calls++
		return models.Chat{}, models.ErrNotFound
	}}
	service := newService(repo, newFakeCache())

	for range 2 {
		_, _, _, err := service.GetChat(context.Background(), "owner-1", "chat-1")
		if !errors.Is(err, models.ErrNotFound) {
			t.Fatalf("GetChat = %v, want not_found", err)
		}
	}
	if calls != 1 {
		t.Errorf("source reads = %d, want one", calls)
	}
}

func TestTheNegativeMarkerIsScopedToTheOwner(t *testing.T) {
	calls := map[string]int{}
	repo := &fakeRepository{chat: func(_ context.Context, ownerID, _ string) (models.Chat, error) {
		calls[ownerID]++
		return models.Chat{}, models.ErrNotFound
	}}
	service := newService(repo, newFakeCache())

	for _, ownerID := range []string{"owner-1", "owner-2"} {
		for range 2 {
			_, _, _, err := service.GetChat(context.Background(), ownerID, "chat-1")
			if !errors.Is(err, models.ErrNotFound) {
				t.Fatalf("GetChat for %s = %v, want not_found", ownerID, err)
			}
		}
	}
	if calls["owner-1"] != 1 || calls["owner-2"] != 1 {
		t.Errorf("source reads = %v, want one per owner", calls)
	}
}

func TestAWriteClearsTheNegativeMarker(t *testing.T) {
	calls := 0
	repo := &fakeRepository{
		chat: func(_ context.Context, ownerID, chatID string) (models.Chat, error) {
			calls++
			if calls == 1 {
				return models.Chat{}, models.ErrNotFound
			}
			return models.Chat{ID: chatID, UserID: ownerID, Title: "now here"}, nil
		},
		renameChat: func(context.Context, string, string, string) (models.ChatSummary, error) {
			return models.ChatSummary{}, nil
		},
	}
	service := newService(repo, newFakeCache())
	ctx := context.Background()

	if _, _, _, err := service.GetChat(ctx, "owner-1", "chat-1"); !errors.Is(err, models.ErrNotFound) {
		t.Fatalf("first GetChat = %v, want not_found", err)
	}
	if _, err := service.RenameChat(ctx, "owner-1", "chat-1", "new"); err != nil {
		t.Fatalf("RenameChat: %v", err)
	}
	chat, _, _, err := service.GetChat(ctx, "owner-1", "chat-1")
	if err != nil {
		t.Fatalf("GetChat after the write: %v", err)
	}
	if chat.Title != "now here" || calls != 2 {
		t.Errorf("chat = %+v, source reads = %d; want the new chat after one fresh read", chat, calls)
	}
}

func TestANegativeWriteFaultDoesNotFailTheCall(t *testing.T) {
	repo := &fakeRepository{chat: func(context.Context, string, string) (models.Chat, error) {
		return models.Chat{}, models.ErrNotFound
	}}
	entries := newFakeCache()
	entries.writeErr = errors.New("redis is down")
	service := newService(repo, entries)

	_, _, _, err := service.GetChat(context.Background(), "owner-1", "chat-1")
	if !errors.Is(err, models.ErrNotFound) {
		t.Errorf("GetChat = %v, want not_found even when the marker write fails", err)
	}
}

func TestANegativeReadFaultFailsOpen(t *testing.T) {
	calls := 0
	repo := &fakeRepository{chat: func(context.Context, string, string) (models.Chat, error) {
		calls++
		return models.Chat{}, models.ErrNotFound
	}}
	entries := newFakeCache()
	entries.readErr = errors.New("redis is down")
	service := newService(repo, entries)

	for range 2 {
		_, _, _, err := service.GetChat(context.Background(), "owner-1", "chat-1")
		if !errors.Is(err, models.ErrNotFound) {
			t.Fatalf("GetChat = %v, want not_found", err)
		}
	}
	if calls != 2 {
		t.Errorf("source reads = %d, want one per call when the negative read faults", calls)
	}
}
