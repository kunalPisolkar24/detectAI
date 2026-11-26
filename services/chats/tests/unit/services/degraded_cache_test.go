package services_test

import (
	"context"
	"slices"
	"testing"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/cache/entries"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/models"
)

func TestNullCacheServesEveryReadFromTheRepository(t *testing.T) {
	repo := &fakeRepository{
		chat: func(_ context.Context, ownerID, chatID string) (models.Chat, error) {
			return models.Chat{ID: chatID, UserID: ownerID, Title: "from the source"}, nil
		},
		chatHistory: func(_ context.Context, _ string, chatID, _ string, _ int) ([]models.Message, string, error) {
			return []models.Message{{ID: "m1", ChatID: chatID}}, "", nil
		},
	}
	service := newService(repo, entries.Null{})

	chat, messages, _, err := service.GetChat(context.Background(), "owner-1", "chat-1")
	if err != nil {
		t.Fatalf("GetChat: %v", err)
	}
	if chat.Title != "from the source" {
		t.Errorf("title = %q, want the repository's value", chat.Title)
	}
	if len(messages) != 1 {
		t.Errorf("messages = %+v, want the head page from the repository", messages)
	}
	if !slices.Contains(repo.calls, "Chat") || !slices.Contains(repo.calls, "ChatHistory") {
		t.Errorf("repository calls = %v, want the reads to reach the source", repo.calls)
	}
}
