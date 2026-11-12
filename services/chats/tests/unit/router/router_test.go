package router_test

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"connectrpc.com/connect"
	"connectrpc.com/grpchealth"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/db"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/router"
	"github.com/kunalPisolkar24/detectAI/services/chats/proto"
	chatv1connect "github.com/kunalPisolkar24/detectAI/services/chats/proto/chatv1connect"
)

type fakeDatabase struct {
	pingErr error
}

func (f fakeDatabase) Ping(context.Context) error       { return f.pingErr }
func (f fakeDatabase) Disconnect(context.Context) error { return nil }

func newServer(t *testing.T, database db.Database) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(router.New(database))
	t.Cleanup(srv.Close)
	return srv
}

func TestChatServiceAnswersUnimplemented(t *testing.T) {
	srv := newServer(t, fakeDatabase{})

	client := chatv1connect.NewChatServiceClient(srv.Client(), srv.URL)

	_, err := client.GetChat(context.Background(), connect.NewRequest(&chatv1.GetChatRequest{ChatId: "chat-1"}))
	if connect.CodeOf(err) != connect.CodeUnimplemented {
		t.Fatalf("GetChat code = %v, want %v", connect.CodeOf(err), connect.CodeUnimplemented)
	}
}

func TestHealthAdvertisesChatService(t *testing.T) {
	srv := newServer(t, fakeDatabase{})

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
	srv := newServer(t, fakeDatabase{})

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
	srv := newServer(t, fakeDatabase{pingErr: errors.New("down")})

	resp, err := srv.Client().Get(srv.URL + "/api/v1/ready")
	if err != nil {
		t.Fatalf("GET ready: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("GET ready status = %d, want 503", resp.StatusCode)
	}
}
