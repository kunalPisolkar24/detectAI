package services_test

import (
	"context"
	"errors"
	"log/slog"
	"testing"
	"time"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/cache/client"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/cache/coalescer"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/cache/entries"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/cache/lock"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/cache/store"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/db"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/models"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/observability"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/repository"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/services"
	"github.com/kunalPisolkar24/detectAI/services/chats/tests/integration/support"
)

func TestMongoOutageKeepsCachedReadsAndFailsWrites(t *testing.T) {
	if !support.DockerUp() {
		t.Skip("docker daemon unreachable; the container-backed layer needs it")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	fixture, err := support.NewMongo(ctx)
	if err != nil {
		t.Fatalf("start the mongo container: %v", err)
	}
	t.Cleanup(func() { fixture.Terminate(ctx) })

	dbClient, err := db.Connect(ctx, fixture.URI, testDatabase)
	if err != nil {
		t.Fatalf("db.Connect: %v", err)
	}
	t.Cleanup(func() { _ = dbClient.Disconnect(context.Background()) })

	repo, err := repository.New(ctx, dbClient.Database(), observability.NullTelemetry{})
	if err != nil {
		t.Fatalf("repository.New: %v", err)
	}
	cacheClient, err := client.Connect(ctx, support.Redis(t).Endpoint)
	if err != nil {
		t.Fatalf("client.Connect: %v", err)
	}
	t.Cleanup(func() { _ = cacheClient.Disconnect(context.Background()) })

	svc := services.NewChatService(repo, entries.New(store.NewRedis(cacheClient)), lock.NewRedis(cacheClient), coalescer.NewFlightGroup(), lock.NewPolicy(10*time.Second), slog.New(slog.DiscardHandler), observability.NullTelemetry{})
	ownerID := owner()
	chat, err := svc.CreateChat(ctx, ownerID, "a question")
	if err != nil {
		t.Fatalf("CreateChat: %v", err)
	}
	if _, _, _, err := svc.GetChat(ctx, ownerID, chat.ID); err != nil {
		t.Fatalf("warm the chat cache: %v", err)
	}
	if _, err := svc.ListChats(ctx, ownerID, 10); err != nil {
		t.Fatalf("warm the list cache: %v", err)
	}

	fixture.Stop(t)

	got, messages, _, err := svc.GetChat(ctx, ownerID, chat.ID)
	if err != nil {
		t.Fatalf("GetChat over a dead mongo: %v", err)
	}
	if got.ID != chat.ID {
		t.Errorf("chat id = %q, want %q", got.ID, chat.ID)
	}
	if len(messages) != 1 {
		t.Errorf("messages = %+v, want the cached head page", messages)
	}
	if chats, err := svc.ListChats(ctx, ownerID, 10); err != nil || len(chats) != 1 {
		t.Errorf("ListChats = (%+v, %v), want the cached list", chats, err)
	}

	_, err = svc.SaveUserMessage(ctx, ownerID, chat.ID, "message-2", "another question", time.Now().UTC())
	if !errors.Is(err, models.ErrUnavailable) {
		t.Errorf("SaveUserMessage error = %v, want models.ErrUnavailable", err)
	}
}
