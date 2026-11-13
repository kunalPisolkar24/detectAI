package router_test

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"connectrpc.com/connect"
	"connectrpc.com/grpchealth"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/cache"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/db"
	chatshandlers "github.com/kunalPisolkar24/detectAI/services/chats/internal/handlers"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/models"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/observability"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/router"
	"github.com/kunalPisolkar24/detectAI/services/chats/proto"
	chatv1connect "github.com/kunalPisolkar24/detectAI/services/chats/proto/chatv1connect"
)

const testAPIKey = "key-0123456789abcdef79"

type fakeDatabase struct {
	pingErr error
}

func (f fakeDatabase) Ping(context.Context) error       { return f.pingErr }
func (f fakeDatabase) Disconnect(context.Context) error { return nil }

// stubService answers the one RPC the router tests exercise.
type stubService struct {
	getChat func(ctx context.Context, ownerID, chatID string) (models.Chat, []models.Message, string, error)
}

func (s stubService) CreateChat(context.Context, string, string) (models.Chat, error) {
	return models.Chat{}, nil
}

func (s stubService) GetChat(ctx context.Context, ownerID, chatID string) (models.Chat, []models.Message, string, error) {
	if s.getChat == nil {
		return models.Chat{}, nil, "", nil
	}
	return s.getChat(ctx, ownerID, chatID)
}

func (s stubService) ListChats(context.Context, string, int) ([]models.ChatSummary, error) {
	return nil, nil
}

func (s stubService) RenameChat(context.Context, string, string, string) (models.ChatSummary, error) {
	return models.ChatSummary{}, nil
}

func (s stubService) DeleteChat(context.Context, string, string) error { return nil }

func (s stubService) SaveUserMessage(context.Context, string, string, string, string, time.Time) (models.Message, error) {
	return models.Message{}, nil
}

func (s stubService) SaveAnalysisMessage(context.Context, string, string, string, time.Time, *models.Analysis) (models.Message, error) {
	return models.Message{}, nil
}

func (s stubService) GetChatHistory(context.Context, string, string, string, int) ([]models.Message, string, error) {
	return nil, "", nil
}

func newServer(t *testing.T, database db.Database, service stubService) *httptest.Server {
	t.Helper()
	return newServerWithLimiter(t, database, service, allowAllLimiter{})
}

func newServerWithLimiter(t *testing.T, database db.Database, service stubService, limiter cache.Limiter) *httptest.Server {
	t.Helper()
	return newServerWithLogger(t, database, service, limiter, slog.Default())
}

func newServerWithLogger(t *testing.T, database db.Database, service stubService, limiter cache.Limiter, logger *slog.Logger) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(router.New(database, service, testAPIKey, limiter, chatshandlers.Limits{Create: 10, Write: 60}, logger, observability.NullTelemetry{}))
	t.Cleanup(srv.Close)
	return srv
}

func TestChatServiceRejectsAnUnauthenticatedCall(t *testing.T) {
	srv := newServer(t, fakeDatabase{}, stubService{})

	client := chatv1connect.NewChatServiceClient(srv.Client(), srv.URL)

	_, err := client.GetChat(context.Background(), connect.NewRequest(&chatv1.GetChatRequest{ChatId: "chat-1"}))
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("GetChat code = %v, want %v", connect.CodeOf(err), connect.CodeUnauthenticated)
	}
}

func TestChatServiceRejectsAWrongAPIKey(t *testing.T) {
	srv := newServer(t, fakeDatabase{}, stubService{})

	client := chatv1connect.NewChatServiceClient(srv.Client(), srv.URL)

	req := connect.NewRequest(&chatv1.GetChatRequest{ChatId: "chat-1"})
	req.Header().Set("x-api-key", "wrong-key-0123456789abcd")
	req.Header().Set("x-user-id", "owner-1")

	_, err := client.GetChat(context.Background(), req)
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("GetChat code = %v, want %v", connect.CodeOf(err), connect.CodeUnauthenticated)
	}
}

func TestChatServiceResolvesTheOwnerFromTheHeader(t *testing.T) {
	var ownerID string
	service := stubService{
		getChat: func(_ context.Context, owner string, chatID string) (models.Chat, []models.Message, string, error) {
			ownerID = owner
			return models.Chat{ID: chatID, UserID: owner, Title: "a title"}, nil, "", nil
		},
	}
	srv := newServer(t, fakeDatabase{}, service)

	client := chatv1connect.NewChatServiceClient(srv.Client(), srv.URL)

	req := connect.NewRequest(&chatv1.GetChatRequest{ChatId: "chat-1"})
	req.Header().Set("x-api-key", testAPIKey)
	req.Header().Set("x-user-id", "owner-1")

	resp, err := client.GetChat(context.Background(), req)
	if err != nil {
		t.Fatalf("GetChat: %v", err)
	}
	if ownerID != "owner-1" {
		t.Errorf("owner = %q, want %q", ownerID, "owner-1")
	}
	if resp.Msg.Title != "a title" {
		t.Errorf("title = %q, want %q", resp.Msg.Title, "a title")
	}
}

func TestHealthAdvertisesChatService(t *testing.T) {
	srv := newServer(t, fakeDatabase{}, stubService{})

	client := grpchealth.NewClient(srv.Client(), srv.URL)

	resp, err := client.Check(context.Background(), &grpchealth.CheckRequest{Service: "chats.v1.ChatService"})
	if err != nil {
		t.Fatalf("Check: %v", err)
	}
	if resp.Status != grpchealth.StatusServing {
		t.Fatalf("health status = %v, want %v", resp.Status, grpchealth.StatusServing)
	}
}

func TestProbesServe(t *testing.T) {
	srv := newServer(t, fakeDatabase{}, stubService{})

	for _, path := range []string{"/api/v1/health", "/api/v1/ready"} {
		resp, err := srv.Client().Get(srv.URL + path)
		if err != nil {
			t.Fatalf("GET %s: %v", path, err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("GET %s status = %d, want %d", path, resp.StatusCode, http.StatusOK)
		}
	}
}

func TestReadyReflectsDatabaseHealth(t *testing.T) {
	srv := newServer(t, fakeDatabase{pingErr: errors.New("down")}, stubService{})

	resp, err := srv.Client().Get(srv.URL + "/api/v1/ready")
	if err != nil {
		t.Fatalf("GET ready: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("GET ready status = %d, want 503", resp.StatusCode)
	}
}
