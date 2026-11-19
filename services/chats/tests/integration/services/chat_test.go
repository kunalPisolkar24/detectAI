// Package services_test drives the chat service against container-backed mongo and redis.
package services_test

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	driver "github.com/redis/go-redis/v9"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/cache"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/db"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/models"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/observability"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/repository"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/services"
	"github.com/kunalPisolkar24/detectAI/services/chats/tests/integration/support"
)

const testDatabase = "chat_db_test"

func TestMain(m *testing.M) {
	support.Main(m)
}

// stack is the service wired to the container planes, with a raw redis client
// for the assertions the cache surface does not expose.
type stack struct {
	service *services.ChatService
	redis   *driver.Client
}

func TestCreateChatPersistsTheFirstMessage(t *testing.T) {
	service := newStack(t).service
	owner := owner()
	ctx := testContext(t)

	chat, err := service.CreateChat(ctx, owner, "who wrote the retry logic")
	if err != nil {
		t.Fatalf("CreateChat: %v", err)
	}
	if chat.Title != "who wrote the retry logic" {
		t.Errorf("title = %q, want the derived first message", chat.Title)
	}

	messages, _, err := service.GetChatHistory(ctx, owner, chat.ID, "", 10)
	if err != nil {
		t.Fatalf("GetChatHistory: %v", err)
	}
	if len(messages) != 1 {
		t.Fatalf("messages = %d, want the first message", len(messages))
	}
	if messages[0].Content != "who wrote the retry logic" {
		t.Errorf("content = %q, want the initial message", messages[0].Content)
	}
	if messages[0].Role != models.RoleUser {
		t.Errorf("role = %q, want the user role", messages[0].Role)
	}
}

func TestAReadPopulatesTheCache(t *testing.T) {
	stack := newStack(t)
	owner := owner()
	ctx := testContext(t)

	chat, err := stack.service.CreateChat(ctx, owner, "a question")
	if err != nil {
		t.Fatalf("CreateChat: %v", err)
	}
	if _, _, _, err := stack.service.GetChat(ctx, owner, chat.ID); err != nil {
		t.Fatalf("GetChat: %v", err)
	}
	if _, err := stack.service.ListChats(ctx, owner, 0); err != nil {
		t.Fatalf("ListChats: %v", err)
	}

	for _, key := range []string{
		cache.ChatKey(chat.ID),
		cache.ChatHeadKey(chat.ID),
		cache.OwnerChatsKey(owner),
	} {
		if exists := stack.redis.Exists(ctx, key).Val(); exists == 0 {
			t.Errorf("key %s is missing, want the read to populate it", key)
		}
	}
}

func TestARenameInvalidatesTheCachedChat(t *testing.T) {
	stack := newStack(t)
	owner := owner()
	ctx := testContext(t)

	chat, err := stack.service.CreateChat(ctx, owner, "before")
	if err != nil {
		t.Fatalf("CreateChat: %v", err)
	}
	if _, _, _, err := stack.service.GetChat(ctx, owner, chat.ID); err != nil {
		t.Fatalf("GetChat: %v", err)
	}

	summary, err := stack.service.RenameChat(ctx, owner, chat.ID, "after")
	if err != nil {
		t.Fatalf("RenameChat: %v", err)
	}
	if summary.Title != "after" {
		t.Errorf("title = %q, want %q", summary.Title, "after")
	}
	if exists := stack.redis.Exists(ctx, cache.ChatKey(chat.ID)).Val(); exists != 0 {
		t.Error("the cached chat survived the rename, want it invalidated")
	}
}

func TestAnAppendInvalidatesTheCachedHead(t *testing.T) {
	stack := newStack(t)
	owner := owner()
	ctx := testContext(t)

	chat, err := stack.service.CreateChat(ctx, owner, "first")
	if err != nil {
		t.Fatalf("CreateChat: %v", err)
	}
	if _, _, _, err := stack.service.GetChat(ctx, owner, chat.ID); err != nil {
		t.Fatalf("GetChat: %v", err)
	}

	if _, err := stack.service.SaveUserMessage(ctx, owner, chat.ID, uuid.NewString(), "second", time.Now().UTC()); err != nil {
		t.Fatalf("SaveUserMessage: %v", err)
	}
	if exists := stack.redis.Exists(ctx, cache.ChatHeadKey(chat.ID)).Val(); exists != 0 {
		t.Error("the cached head survived the append, want it invalidated")
	}
}

func TestACreateInvalidatesTheOwnerList(t *testing.T) {
	stack := newStack(t)
	owner := owner()
	ctx := testContext(t)

	if _, err := stack.service.ListChats(ctx, owner, 0); err != nil {
		t.Fatalf("ListChats: %v", err)
	}
	if exists := stack.redis.Exists(ctx, cache.OwnerChatsKey(owner)).Val(); exists == 0 {
		t.Fatal("the sidebar list is missing, want the read to populate it")
	}

	if _, err := stack.service.CreateChat(ctx, owner, "a new chat"); err != nil {
		t.Fatalf("CreateChat: %v", err)
	}
	if exists := stack.redis.Exists(ctx, cache.OwnerChatsKey(owner)).Val(); exists != 0 {
		t.Error("the cached sidebar survived the create, want it invalidated")
	}
}

func TestADeleteInvalidatesTheChat(t *testing.T) {
	stack := newStack(t)
	owner := owner()
	ctx := testContext(t)

	chat, err := stack.service.CreateChat(ctx, owner, "doomed")
	if err != nil {
		t.Fatalf("CreateChat: %v", err)
	}
	if _, _, _, err := stack.service.GetChat(ctx, owner, chat.ID); err != nil {
		t.Fatalf("GetChat: %v", err)
	}

	if err := stack.service.DeleteChat(ctx, owner, chat.ID); err != nil {
		t.Fatalf("DeleteChat: %v", err)
	}
	for _, key := range []string{cache.ChatKey(chat.ID), cache.ChatHeadKey(chat.ID)} {
		if exists := stack.redis.Exists(ctx, key).Val(); exists != 0 {
			t.Errorf("key %s survived the delete, want it invalidated", key)
		}
	}
}

func TestACachedChatStillEnforcesOwnership(t *testing.T) {
	stack := newStack(t)
	ownerID := owner()
	ctx := testContext(t)

	chat, err := stack.service.CreateChat(ctx, ownerID, "private")
	if err != nil {
		t.Fatalf("CreateChat: %v", err)
	}
	if _, _, _, err := stack.service.GetChat(ctx, ownerID, chat.ID); err != nil {
		t.Fatalf("GetChat: %v", err)
	}

	if _, _, _, err := stack.service.GetChat(ctx, owner(), chat.ID); !errors.Is(err, models.ErrNotFound) {
		t.Errorf("err = %v, want %v for another owner reading a cached chat", err, models.ErrNotFound)
	}
}

func TestARedisOutageDegradesToTheSource(t *testing.T) {
	if !support.DockerUp() {
		t.Skip("docker daemon unreachable; the container-backed layer needs it")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	fixture, err := support.NewRedis(ctx)
	if err != nil {
		t.Fatalf("start the redis container: %v", err)
	}
	t.Cleanup(func() { fixture.Terminate(ctx) })

	var logs bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&logs, nil))
	stack := newStackWith(t, fixture.Endpoint, logger)
	owner := owner()

	chat, err := stack.service.CreateChat(ctx, owner, "a question")
	if err != nil {
		t.Fatalf("CreateChat: %v", err)
	}
	fixture.Stop(t)

	read, _, _, err := stack.service.GetChat(ctx, owner, chat.ID)
	if err != nil {
		t.Fatalf("GetChat over a dead redis: %v", err)
	}
	if read.ID != chat.ID {
		t.Errorf("chat id = %q, want %q", read.ID, chat.ID)
	}
	if _, err := stack.service.CreateChat(ctx, owner, "another question"); err != nil {
		t.Fatalf("CreateChat over a dead redis: %v", err)
	}
	if !strings.Contains(logs.String(), "cache fault absorbed") {
		t.Errorf("the cache fault was not logged: %s", logs.String())
	}
}

// newStack wires the service to the shared container planes.
func newStack(t *testing.T) *stack {
	t.Helper()
	return newStackWith(t, support.Redis(t).Endpoint, slog.Default())
}

// newStackWith wires the service to the given redis endpoint, so the outage
// paths can point it at a container they kill.
func newStackWith(t *testing.T, endpoint string, logger *slog.Logger) *stack {
	t.Helper()
	mongoURI := support.Mongo(t).URI
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	dbClient, err := db.Connect(ctx, mongoURI, testDatabase)
	if err != nil {
		t.Fatalf("db.Connect: %v", err)
	}
	t.Cleanup(func() { _ = dbClient.Disconnect(context.Background()) })

	repo, err := repository.New(ctx, dbClient.Database(), observability.NullTelemetry{})
	if err != nil {
		t.Fatalf("repository.New: %v", err)
	}

	cacheClient, err := cache.Connect(ctx, endpoint, "")
	if err != nil {
		t.Fatalf("cache.Connect: %v", err)
	}
	t.Cleanup(func() { _ = cacheClient.Disconnect(context.Background()) })

	opts, err := driver.ParseURL(endpoint)
	if err != nil {
		t.Fatalf("parse the redis endpoint: %v", err)
	}
	raw := driver.NewClient(opts)
	t.Cleanup(func() { _ = raw.Close() })

	return &stack{
		service: services.NewChatService(repo, cache.NewEntries(cacheClient), logger, observability.NullTelemetry{}),
		redis:   raw,
	}
}

// owner returns an identity no other test shares.
func owner() string {
	return "owner-" + uuid.NewString()
}

func testContext(t *testing.T) context.Context {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	t.Cleanup(cancel)
	return ctx
}
