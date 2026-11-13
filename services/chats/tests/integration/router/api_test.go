// Package router_test drives the mounted ChatService against container-backed mongo and redis.
package router_test

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"connectrpc.com/connect"
	"connectrpc.com/grpchealth"
	"github.com/google/uuid"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/cache"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/config"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/db"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/handlers"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/repository"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/router"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/services"
	chatv1 "github.com/kunalPisolkar24/detectAI/services/chats/proto"
	chatv1connect "github.com/kunalPisolkar24/detectAI/services/chats/proto/chatv1connect"
	"github.com/kunalPisolkar24/detectAI/services/chats/tests/integration/support"
)

const (
	testAPIKey    = "key-0123456789abcdef79"
	testDatabase  = "chat_db_test"
	defaultCreate = 10
	defaultWrite  = 60
)

func TestMain(m *testing.M) {
	support.Main(m)
}

// stack is the whole service, booted the way cmd/api boots it.
type stack struct {
	client  chatv1connect.ChatServiceClient
	http    *http.Client
	baseURL string
}

func TestAMissingAPIKeyIsRejected(t *testing.T) {
	stack := newStack(t)

	req := connect.NewRequest(&chatv1.ListChatsRequest{})
	req.Header().Set("x-user-id", owner())

	_, err := stack.client.ListChats(context.Background(), req)
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("ListChats code = %v, want %v", connect.CodeOf(err), connect.CodeUnauthenticated)
	}
}

func TestAWrongAPIKeyIsRejected(t *testing.T) {
	stack := newStack(t)

	req := connect.NewRequest(&chatv1.ListChatsRequest{})
	req.Header().Set("x-api-key", "wrong-key-0123456789abcd")
	req.Header().Set("x-user-id", owner())

	_, err := stack.client.ListChats(context.Background(), req)
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("ListChats code = %v, want %v", connect.CodeOf(err), connect.CodeUnauthenticated)
	}
}

func TestAMissingUserIDIsRejected(t *testing.T) {
	stack := newStack(t)

	req := connect.NewRequest(&chatv1.ListChatsRequest{})
	req.Header().Set("x-api-key", testAPIKey)

	_, err := stack.client.ListChats(context.Background(), req)
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("ListChats code = %v, want %v", connect.CodeOf(err), connect.CodeUnauthenticated)
	}
}

func TestTheChatLifecycleOverTheWire(t *testing.T) {
	stack := newStack(t)
	ownerID := owner()
	ctx := context.Background()

	created, err := stack.client.CreateChat(ctx, request(ownerID, &chatv1.CreateChatRequest{InitialMessage: "who wrote the retry logic"}))
	if err != nil {
		t.Fatalf("CreateChat: %v", err)
	}
	if created.Msg.Id == "" {
		t.Fatal("chat id is empty, want a server-generated id")
	}
	if created.Msg.Title != "who wrote the retry logic" {
		t.Errorf("title = %q, want the derived first message", created.Msg.Title)
	}

	fetched, err := stack.client.GetChat(ctx, request(ownerID, &chatv1.GetChatRequest{ChatId: created.Msg.Id}))
	if err != nil {
		t.Fatalf("GetChat: %v", err)
	}
	if fetched.Msg.Title != created.Msg.Title {
		t.Errorf("title = %q, want %q", fetched.Msg.Title, created.Msg.Title)
	}
	if len(fetched.Msg.Messages) != 1 {
		t.Fatalf("messages = %d, want the first message", len(fetched.Msg.Messages))
	}
	if fetched.Msg.Messages[0].Content != "who wrote the retry logic" {
		t.Errorf("content = %q, want the initial message", fetched.Msg.Messages[0].Content)
	}

	listed, err := stack.client.ListChats(ctx, request(ownerID, &chatv1.ListChatsRequest{}))
	if err != nil {
		t.Fatalf("ListChats: %v", err)
	}
	if len(listed.Msg.Chats) != 1 || listed.Msg.Chats[0].Id != created.Msg.Id {
		t.Fatalf("chats = %+v, want the created chat", listed.Msg.Chats)
	}

	renamed, err := stack.client.RenameChat(ctx, request(ownerID, &chatv1.RenameChatRequest{ChatId: created.Msg.Id, Title: "a clearer title"}))
	if err != nil {
		t.Fatalf("RenameChat: %v", err)
	}
	if renamed.Msg.Title != "a clearer title" {
		t.Errorf("title = %q, want %q", renamed.Msg.Title, "a clearer title")
	}

	if _, err := stack.client.DeleteChat(ctx, request(ownerID, &chatv1.DeleteChatRequest{ChatId: created.Msg.Id})); err != nil {
		t.Fatalf("DeleteChat: %v", err)
	}
	if _, err := stack.client.DeleteChat(ctx, request(ownerID, &chatv1.DeleteChatRequest{ChatId: created.Msg.Id})); err != nil {
		t.Fatalf("the second DeleteChat: %v", err)
	}
	_, err = stack.client.GetChat(ctx, request(ownerID, &chatv1.GetChatRequest{ChatId: created.Msg.Id}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("GetChat after the delete code = %v, want %v", connect.CodeOf(err), connect.CodeNotFound)
	}
}

func TestSaveUserMessageIsInsertOnly(t *testing.T) {
	stack := newStack(t)
	ownerID := owner()
	ctx := context.Background()

	chat, err := stack.client.CreateChat(ctx, request(ownerID, &chatv1.CreateChatRequest{InitialMessage: "a question"}))
	if err != nil {
		t.Fatalf("CreateChat: %v", err)
	}
	messageID := uuid.NewString()

	saved, err := stack.client.SaveUserMessage(ctx, request(ownerID, &chatv1.SaveUserMessageRequest{
		ChatId:    chat.Msg.Id,
		MessageId: messageID,
		Content:   "the original",
	}))
	if err != nil {
		t.Fatalf("SaveUserMessage: %v", err)
	}
	if saved.Msg.Content != "the original" {
		t.Errorf("content = %q, want %q", saved.Msg.Content, "the original")
	}

	replay, err := stack.client.SaveUserMessage(ctx, request(ownerID, &chatv1.SaveUserMessageRequest{
		ChatId:    chat.Msg.Id,
		MessageId: messageID,
		Content:   "a different take",
	}))
	if err != nil {
		t.Fatalf("the replayed SaveUserMessage: %v", err)
	}
	if replay.Msg.Content != "the original" {
		t.Errorf("content = %q, want the stored %q", replay.Msg.Content, "the original")
	}
}

func TestSaveAnalysisMessageWalksTheStateMachine(t *testing.T) {
	stack := newStack(t)
	ownerID := owner()
	ctx := context.Background()

	chat, err := stack.client.CreateChat(ctx, request(ownerID, &chatv1.CreateChatRequest{InitialMessage: "a question"}))
	if err != nil {
		t.Fatalf("CreateChat: %v", err)
	}
	messageID := uuid.NewString()

	running, err := stack.client.SaveAnalysisMessage(ctx, request(ownerID, &chatv1.SaveAnalysisMessageRequest{
		ChatId:          chat.Msg.Id,
		MessageId:       messageID,
		State:           chatv1.AnalysisState_ANALYSIS_STATE_RUNNING,
		Model:           chatv1.Model_MODEL_SPARK,
		SourceMessageId: "source-1",
	}))
	if err != nil {
		t.Fatalf("SaveAnalysisMessage: %v", err)
	}
	if running.Msg.Analysis == nil || running.Msg.Analysis.State != chatv1.AnalysisState_ANALYSIS_STATE_RUNNING {
		t.Fatalf("analysis = %+v, want the running state", running.Msg.Analysis)
	}

	completed, err := stack.client.SaveAnalysisMessage(ctx, request(ownerID, &chatv1.SaveAnalysisMessageRequest{
		ChatId:          chat.Msg.Id,
		MessageId:       messageID,
		State:           chatv1.AnalysisState_ANALYSIS_STATE_COMPLETED,
		Model:           chatv1.Model_MODEL_SPARK,
		SourceMessageId: "source-1",
		Analysis: &chatv1.AnalysisResult{
			Label:      chatv1.Label_LABEL_AI,
			Confidence: 0.9,
			Scores:     &chatv1.Scores{Ai: 0.9, Human: 0.1},
		},
	}))
	if err != nil {
		t.Fatalf("SaveAnalysisMessage: %v", err)
	}
	if completed.Msg.Analysis == nil || completed.Msg.Analysis.State != chatv1.AnalysisState_ANALYSIS_STATE_COMPLETED {
		t.Fatalf("analysis = %+v, want the completed state", completed.Msg.Analysis)
	}
	if completed.Msg.Analysis.Result == nil || completed.Msg.Analysis.Result.Label != chatv1.Label_LABEL_AI {
		t.Errorf("result = %+v, want the ai verdict", completed.Msg.Analysis.Result)
	}
}

func TestSaveAnalysisMessageRejectsAConflictingTerminalWrite(t *testing.T) {
	stack := newStack(t)
	ownerID := owner()
	ctx := context.Background()

	chat, err := stack.client.CreateChat(ctx, request(ownerID, &chatv1.CreateChatRequest{InitialMessage: "a question"}))
	if err != nil {
		t.Fatalf("CreateChat: %v", err)
	}
	messageID := uuid.NewString()

	_, err = stack.client.SaveAnalysisMessage(ctx, request(ownerID, &chatv1.SaveAnalysisMessageRequest{
		ChatId:          chat.Msg.Id,
		MessageId:       messageID,
		State:           chatv1.AnalysisState_ANALYSIS_STATE_COMPLETED,
		Model:           chatv1.Model_MODEL_SPARK,
		SourceMessageId: "source-1",
		Analysis: &chatv1.AnalysisResult{
			Label:      chatv1.Label_LABEL_AI,
			Confidence: 0.9,
			Scores:     &chatv1.Scores{Ai: 0.9, Human: 0.1},
		},
	}))
	if err != nil {
		t.Fatalf("SaveAnalysisMessage: %v", err)
	}

	_, err = stack.client.SaveAnalysisMessage(ctx, request(ownerID, &chatv1.SaveAnalysisMessageRequest{
		ChatId:          chat.Msg.Id,
		MessageId:       messageID,
		State:           chatv1.AnalysisState_ANALYSIS_STATE_COMPLETED,
		Model:           chatv1.Model_MODEL_SPARK,
		SourceMessageId: "source-1",
		Analysis: &chatv1.AnalysisResult{
			Label:      chatv1.Label_LABEL_HUMAN,
			Confidence: 0.2,
			Scores:     &chatv1.Scores{Ai: 0.2, Human: 0.8},
		},
	}))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("SaveAnalysisMessage code = %v, want %v", connect.CodeOf(err), connect.CodeFailedPrecondition)
	}
}

func TestSaveAnalysisMessageRejectsCompletedWithoutAResult(t *testing.T) {
	stack := newStack(t)
	ownerID := owner()
	ctx := context.Background()

	chat, err := stack.client.CreateChat(ctx, request(ownerID, &chatv1.CreateChatRequest{InitialMessage: "a question"}))
	if err != nil {
		t.Fatalf("CreateChat: %v", err)
	}

	_, err = stack.client.SaveAnalysisMessage(ctx, request(ownerID, &chatv1.SaveAnalysisMessageRequest{
		ChatId:          chat.Msg.Id,
		MessageId:       uuid.NewString(),
		State:           chatv1.AnalysisState_ANALYSIS_STATE_COMPLETED,
		Model:           chatv1.Model_MODEL_SPARK,
		SourceMessageId: "source-1",
	}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("SaveAnalysisMessage code = %v, want %v", connect.CodeOf(err), connect.CodeInvalidArgument)
	}
}

func TestGetChatHistoryPagesByCursor(t *testing.T) {
	stack := newStack(t)
	ownerID := owner()
	ctx := context.Background()

	chat, err := stack.client.CreateChat(ctx, request(ownerID, &chatv1.CreateChatRequest{InitialMessage: "the first message"}))
	if err != nil {
		t.Fatalf("CreateChat: %v", err)
	}
	for range 4 {
		if _, err := stack.client.SaveUserMessage(ctx, request(ownerID, &chatv1.SaveUserMessageRequest{
			ChatId:    chat.Msg.Id,
			MessageId: uuid.NewString(),
			Content:   "another message",
		})); err != nil {
			t.Fatalf("SaveUserMessage: %v", err)
		}
	}

	first, err := stack.client.GetChatHistory(ctx, request(ownerID, &chatv1.GetChatHistoryRequest{ChatId: chat.Msg.Id, Limit: 2}))
	if err != nil {
		t.Fatalf("GetChatHistory: %v", err)
	}
	if len(first.Msg.Messages) != 2 {
		t.Fatalf("first page = %d messages, want 2", len(first.Msg.Messages))
	}
	if first.Msg.NextCursor == "" {
		t.Fatal("next cursor is empty, want the next page boundary")
	}

	second, err := stack.client.GetChatHistory(ctx, request(ownerID, &chatv1.GetChatHistoryRequest{
		ChatId: chat.Msg.Id,
		Cursor: first.Msg.NextCursor,
		Limit:  2,
	}))
	if err != nil {
		t.Fatalf("GetChatHistory: %v", err)
	}
	if len(second.Msg.Messages) != 2 {
		t.Fatalf("second page = %d messages, want 2", len(second.Msg.Messages))
	}

	last, err := stack.client.GetChatHistory(ctx, request(ownerID, &chatv1.GetChatHistoryRequest{
		ChatId: chat.Msg.Id,
		Cursor: second.Msg.NextCursor,
		Limit:  2,
	}))
	if err != nil {
		t.Fatalf("GetChatHistory: %v", err)
	}
	if len(last.Msg.Messages) != 1 {
		t.Fatalf("last page = %d messages, want 1", len(last.Msg.Messages))
	}
	if last.Msg.NextCursor != "" {
		t.Errorf("next cursor = %q, want it empty at the end of history", last.Msg.NextCursor)
	}
}

func TestAHistoryCursorFromAnotherChatIsRejected(t *testing.T) {
	stack := newStack(t)
	ownerID := owner()
	ctx := context.Background()

	first, err := stack.client.CreateChat(ctx, request(ownerID, &chatv1.CreateChatRequest{InitialMessage: "the first message"}))
	if err != nil {
		t.Fatalf("CreateChat: %v", err)
	}
	second, err := stack.client.CreateChat(ctx, request(ownerID, &chatv1.CreateChatRequest{InitialMessage: "the second message"}))
	if err != nil {
		t.Fatalf("CreateChat: %v", err)
	}
	if _, err := stack.client.SaveUserMessage(ctx, request(ownerID, &chatv1.SaveUserMessageRequest{
		ChatId:    first.Msg.Id,
		MessageId: uuid.NewString(),
		Content:   "another message",
	})); err != nil {
		t.Fatalf("SaveUserMessage: %v", err)
	}

	page, err := stack.client.GetChatHistory(ctx, request(ownerID, &chatv1.GetChatHistoryRequest{ChatId: first.Msg.Id, Limit: 1}))
	if err != nil {
		t.Fatalf("GetChatHistory: %v", err)
	}
	if page.Msg.NextCursor == "" {
		t.Fatal("next cursor is empty, want the next page boundary")
	}

	_, err = stack.client.GetChatHistory(ctx, request(ownerID, &chatv1.GetChatHistoryRequest{
		ChatId: second.Msg.Id,
		Cursor: page.Msg.NextCursor,
		Limit:  10,
	}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("GetChatHistory code = %v, want %v", connect.CodeOf(err), connect.CodeInvalidArgument)
	}
}

func TestAnotherOwnersChatIsNotFound(t *testing.T) {
	stack := newStack(t)
	ownerID := owner()
	ctx := context.Background()

	chat, err := stack.client.CreateChat(ctx, request(ownerID, &chatv1.CreateChatRequest{InitialMessage: "private"}))
	if err != nil {
		t.Fatalf("CreateChat: %v", err)
	}
	other := owner()

	_, err = stack.client.GetChat(ctx, request(other, &chatv1.GetChatRequest{ChatId: chat.Msg.Id}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Errorf("GetChat code = %v, want %v", connect.CodeOf(err), connect.CodeNotFound)
	}

	_, err = stack.client.RenameChat(ctx, request(other, &chatv1.RenameChatRequest{ChatId: chat.Msg.Id, Title: "hijacked"}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Errorf("RenameChat code = %v, want %v", connect.CodeOf(err), connect.CodeNotFound)
	}

	_, err = stack.client.DeleteChat(ctx, request(other, &chatv1.DeleteChatRequest{ChatId: chat.Msg.Id}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Errorf("DeleteChat code = %v, want %v", connect.CodeOf(err), connect.CodeNotFound)
	}

	_, err = stack.client.SaveUserMessage(ctx, request(other, &chatv1.SaveUserMessageRequest{
		ChatId:    chat.Msg.Id,
		MessageId: uuid.NewString(),
		Content:   "hello",
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Errorf("SaveUserMessage code = %v, want %v", connect.CodeOf(err), connect.CodeNotFound)
	}

	_, err = stack.client.GetChat(ctx, request(ownerID, &chatv1.GetChatRequest{ChatId: chat.Msg.Id}))
	if err != nil {
		t.Fatalf("GetChat after the rejected writes: %v", err)
	}
}

func TestTheCreateBudgetIsEnforced(t *testing.T) {
	stack := newStackWith(t, 2, defaultWrite)
	ownerID := owner()
	ctx := context.Background()

	for attempt := 1; attempt <= 2; attempt++ {
		if _, err := stack.client.CreateChat(ctx, request(ownerID, &chatv1.CreateChatRequest{InitialMessage: "a question"})); err != nil {
			t.Fatalf("CreateChat %d: %v", attempt, err)
		}
	}

	_, err := stack.client.CreateChat(ctx, request(ownerID, &chatv1.CreateChatRequest{InitialMessage: "one too many"}))
	if connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("CreateChat code = %v, want %v", connect.CodeOf(err), connect.CodeResourceExhausted)
	}

	var connectErr *connect.Error
	if !errors.As(err, &connectErr) {
		t.Fatalf("err = %v, want a connect error", err)
	}
	meta := connectErr.Meta()
	if meta.Get("x-ratelimit-limit") != "2" {
		t.Errorf("x-ratelimit-limit = %q, want %q", meta.Get("x-ratelimit-limit"), "2")
	}
	if meta.Get("x-ratelimit-remaining") != "0" {
		t.Errorf("x-ratelimit-remaining = %q, want %q", meta.Get("x-ratelimit-remaining"), "0")
	}
	if meta.Get("retry-after-ms") == "" {
		t.Error("retry-after-ms is empty, want the window hint")
	}
}

func TestEachScopeDrawsFromItsOwnBudget(t *testing.T) {
	stack := newStackWith(t, 1, 1)
	ownerID := owner()
	ctx := context.Background()

	chat, err := stack.client.CreateChat(ctx, request(ownerID, &chatv1.CreateChatRequest{InitialMessage: "a question"}))
	if err != nil {
		t.Fatalf("CreateChat: %v", err)
	}
	if _, err := stack.client.CreateChat(ctx, request(ownerID, &chatv1.CreateChatRequest{InitialMessage: "one too many"})); connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("the second CreateChat code = %v, want %v", connect.CodeOf(err), connect.CodeResourceExhausted)
	}

	if _, err := stack.client.SaveUserMessage(ctx, request(ownerID, &chatv1.SaveUserMessageRequest{
		ChatId:    chat.Msg.Id,
		MessageId: uuid.NewString(),
		Content:   "hello",
	})); err != nil {
		t.Fatalf("SaveUserMessage: %v", err)
	}
	_, err = stack.client.SaveUserMessage(ctx, request(ownerID, &chatv1.SaveUserMessageRequest{
		ChatId:    chat.Msg.Id,
		MessageId: uuid.NewString(),
		Content:   "one too many",
	}))
	if connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("the second SaveUserMessage code = %v, want %v", connect.CodeOf(err), connect.CodeResourceExhausted)
	}
}

func TestTheProbesServe(t *testing.T) {
	stack := newStack(t)

	for _, path := range []string{"/api/v1/health", "/api/v1/ready"} {
		resp, err := stack.http.Get(stack.baseURL + path)
		if err != nil {
			t.Fatalf("GET %s: %v", path, err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Errorf("GET %s status = %d, want %d", path, resp.StatusCode, http.StatusOK)
		}
	}
}

func TestTheHealthCheckAdvertisesTheService(t *testing.T) {
	stack := newStack(t)

	client := grpchealth.NewClient(stack.http, stack.baseURL)
	resp, err := client.Check(context.Background(), &grpchealth.CheckRequest{Service: "chats.v1.ChatService"})
	if err != nil {
		t.Fatalf("Check: %v", err)
	}
	if resp.Status != grpchealth.StatusServing {
		t.Fatalf("health status = %v, want %v", resp.Status, grpchealth.StatusServing)
	}
}

func TestAMongoOutageAnswersUnavailable(t *testing.T) {
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

	stack := newStackWithMongo(t, fixture.URI)
	ownerID := owner()

	chat, err := stack.client.CreateChat(context.Background(), request(ownerID, &chatv1.CreateChatRequest{InitialMessage: "a question"}))
	if err != nil {
		t.Fatalf("CreateChat: %v", err)
	}
	fixture.Stop(t)

	_, err = stack.client.GetChat(context.Background(), request(ownerID, &chatv1.GetChatRequest{ChatId: chat.Msg.Id}))
	if connect.CodeOf(err) != connect.CodeUnavailable {
		t.Fatalf("GetChat code = %v, want %v", connect.CodeOf(err), connect.CodeUnavailable)
	}
}

// request returns a request the auth interceptor accepts.
func request[T any](ownerID string, msg *T) *connect.Request[T] {
	req := connect.NewRequest(msg)
	req.Header().Set("x-api-key", testAPIKey)
	req.Header().Set("x-user-id", ownerID)
	return req
}

// newStack boots the service against the shared container planes.
func newStack(t *testing.T) *stack {
	t.Helper()
	return newStackWith(t, defaultCreate, defaultWrite)
}

// newStackWith boots the service with the given burst budgets.
func newStackWith(t *testing.T, createLimit, writeLimit int) *stack {
	t.Helper()
	return boot(t, support.Mongo(t).URI, support.Redis(t).Endpoint, createLimit, writeLimit)
}

// newStackWithMongo boots the service against the given mongo, so the outage
// path can point it at a container it kills.
func newStackWithMongo(t *testing.T, mongoURI string) *stack {
	t.Helper()
	return boot(t, mongoURI, support.Redis(t).Endpoint, defaultCreate, defaultWrite)
}

// boot assembles the service exactly as cmd/api does and serves it on a listener.
func boot(t *testing.T, mongoURI, redisEndpoint string, createLimit, writeLimit int) *stack {
	t.Helper()

	t.Setenv("ENV_TYPE", "dev")
	t.Setenv("MONGO_URI", mongoURI)
	t.Setenv("MONGO_DATABASE", testDatabase)
	t.Setenv("REDIS_ENDPOINT", redisEndpoint)
	t.Setenv("API_KEY", testAPIKey)
	t.Setenv("RATE_LIMIT_CREATE_MAX", strconv.Itoa(createLimit))
	t.Setenv("RATE_LIMIT_WRITE_MAX", strconv.Itoa(writeLimit))
	t.Setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "")

	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("config.Load: %v", err)
	}

	bootCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	dbClient, err := db.Connect(bootCtx, cfg.MongoURI, cfg.MongoDatabase)
	if err != nil {
		t.Fatalf("db.Connect: %v", err)
	}
	t.Cleanup(func() { _ = dbClient.Disconnect(context.Background()) })

	repo, err := repository.New(bootCtx, dbClient.Database())
	if err != nil {
		t.Fatalf("repository.New: %v", err)
	}

	cacheClient, err := cache.Connect(bootCtx, cfg.RedisEndpoint, cfg.RedisAuthToken)
	if err != nil {
		t.Fatalf("cache.Connect: %v", err)
	}
	t.Cleanup(func() { _ = cacheClient.Disconnect(context.Background()) })

	service := services.NewChatService(repo, cache.NewEntries(cacheClient), slog.Default())
	limits := handlers.Limits{Create: cfg.RateLimitCreateMax, Write: cfg.RateLimitWriteMax}
	srv := httptest.NewServer(router.New(dbClient, service, cfg.APIKey, cache.NewLimiter(cacheClient), limits, slog.Default()))
	t.Cleanup(srv.Close)

	return &stack{
		client:  chatv1connect.NewChatServiceClient(srv.Client(), srv.URL),
		http:    srv.Client(),
		baseURL: srv.URL,
	}
}

// owner returns an identity no other test shares.
func owner() string {
	return "owner-" + uuid.NewString()
}
