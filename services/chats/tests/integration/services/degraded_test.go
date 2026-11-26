package services_test

import (
	"context"
	"log/slog"
	"testing"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/cache/setup"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/db"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/observability"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/repository"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/services"
	"github.com/kunalPisolkar24/detectAI/services/chats/tests/integration/support"
)

func TestBootDegradesToTheSourceWhenRedisIsUnreachable(t *testing.T) {
	ctx := testContext(t)
	service := newDegradedService(t)
	ownerID := owner()

	chat, err := service.CreateChat(ctx, ownerID, "a question")
	if err != nil {
		t.Fatalf("CreateChat: %v", err)
	}

	got, messages, _, err := service.GetChat(ctx, ownerID, chat.ID)
	if err != nil {
		t.Fatalf("GetChat: %v", err)
	}
	if got.ID != chat.ID {
		t.Errorf("chat id = %q, want %q", got.ID, chat.ID)
	}
	if len(messages) != 1 {
		t.Errorf("messages = %+v, want the first message from the source", messages)
	}

	chats, err := service.ListChats(ctx, ownerID, 10)
	if err != nil {
		t.Fatalf("ListChats: %v", err)
	}
	if len(chats) != 1 || chats[0].ID != chat.ID {
		t.Errorf("chats = %+v, want the chat from the source", chats)
	}
}

func newDegradedService(t *testing.T) *services.ChatService {
	t.Helper()
	ctx := testContext(t)

	dbClient, err := db.Connect(ctx, support.Mongo(t).URI, testDatabase)
	if err != nil {
		t.Fatalf("db.Connect: %v", err)
	}
	t.Cleanup(func() { _ = dbClient.Disconnect(context.Background()) })

	repo, err := repository.New(ctx, dbClient.Database(), observability.NullTelemetry{})
	if err != nil {
		t.Fatalf("repository.New: %v", err)
	}

	plane, drain := setup.New(ctx, "redis://127.0.0.1:1")
	t.Cleanup(func() { _ = drain(context.Background()) })

	return services.NewChatService(repo, plane.Entries, slog.New(slog.DiscardHandler), observability.NullTelemetry{})
}
