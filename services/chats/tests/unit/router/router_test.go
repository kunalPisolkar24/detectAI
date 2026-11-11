package router_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"connectrpc.com/connect"
	"connectrpc.com/grpchealth"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/router"
	"github.com/kunalPisolkar24/detectAI/services/chats/proto"
	chatv1connect "github.com/kunalPisolkar24/detectAI/services/chats/proto/chatv1connect"
)

func newServer(t *testing.T) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(router.New())
	t.Cleanup(srv.Close)
	return srv
}

func TestChatServiceAnswersUnimplemented(t *testing.T) {
	srv := newServer(t)
	client := chatv1connect.NewChatServiceClient(srv.Client(), srv.URL)

	_, err := client.GetChat(context.Background(), connect.NewRequest(&chatv1.GetChatRequest{ChatId: "chat-1"}))
	if connect.CodeOf(err) != connect.CodeUnimplemented {
		t.Fatalf("GetChat code = %v, want %v", connect.CodeOf(err), connect.CodeUnimplemented)
	}
}

func TestHealthAdvertisesChatService(t *testing.T) {
	srv := newServer(t)
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
	srv := newServer(t)

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
