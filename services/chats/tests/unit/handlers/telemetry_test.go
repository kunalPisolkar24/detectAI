package handlers_test

import (
	"context"
	"errors"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"connectrpc.com/connect"

	chatshandlers "github.com/kunalPisolkar24/detectAI/services/chats/internal/handlers"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/models"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/observability"
	chatv1 "github.com/kunalPisolkar24/detectAI/services/chats/proto"
	chatv1connect "github.com/kunalPisolkar24/detectAI/services/chats/proto/chatv1connect"
)

// recordingTelemetry captures what the interceptor reports to the seam. The
// server handles the call on its own goroutine, so every read is guarded.
type recordingTelemetry struct {
	mu         sync.Mutex
	tracked    []string
	statuses   []observability.RPCStatus
	codes      []observability.RPCStatus
	procedures []string
	durations  []time.Duration
}

var _ observability.Telemetry = (*recordingTelemetry)(nil)

func (r *recordingTelemetry) TrackRPC(ctx context.Context, procedure string) (context.Context, func(observability.RPCStatus)) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.tracked = append(r.tracked, procedure)
	return ctx, func(status observability.RPCStatus) {
		r.mu.Lock()
		defer r.mu.Unlock()
		r.statuses = append(r.statuses, status)
	}
}

func (r *recordingTelemetry) RecordRPC(procedure string, code observability.RPCStatus, duration time.Duration) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.procedures = append(r.procedures, procedure)
	r.codes = append(r.codes, code)
	r.durations = append(r.durations, duration)
}

func (r *recordingTelemetry) RecordCacheOp(string, observability.CacheResult, time.Duration) {}

func (r *recordingTelemetry) RecordDatastoreOp(string, observability.DatastoreResult, time.Duration) {
}

func (r *recordingTelemetry) RecordRateLimitRefusal(string)    {}
func (r *recordingTelemetry) RecordValidationRejection(string) {}

func (r *recordingTelemetry) Shutdown(context.Context) error { return nil }

func (r *recordingTelemetry) snapshot() ([]string, []observability.RPCStatus, []observability.RPCStatus, []string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.tracked, r.statuses, r.codes, r.procedures
}

// telemetryServer serves the chat RPCs behind the telemetry interceptor.
func telemetryServer(t *testing.T, service *chatshandlers.Handler, recorder *recordingTelemetry) (*httptest.Server, chatv1connect.ChatServiceClient) {
	t.Helper()
	path, handler := chatv1connect.NewChatServiceHandler(
		service,
		connect.WithInterceptors(
			chatshandlers.NewTelemetryInterceptor(recorder),
			chatshandlers.NewAuthInterceptor(testAPIKey),
		),
	)
	mux := httptest.NewServer(handler)
	t.Cleanup(mux.Close)
	if path != "/chats.v1.ChatService/" {
		t.Fatalf("the handler path = %q, want the ChatService prefix", path)
	}
	return mux, chatv1connect.NewChatServiceClient(mux.Client(), mux.URL)
}

// getChatRequest is a request the auth interceptor accepts.
func getChatRequest() *connect.Request[chatv1.GetChatRequest] {
	req := connect.NewRequest(&chatv1.GetChatRequest{ChatId: "chat-1"})
	req.Header().Set("x-user-id", "owner-1")
	req.Header().Set("x-api-key", testAPIKey)
	return req
}

func TestTheInterceptorRecordsTheProcedureAndTheAnswer(t *testing.T) {
	recorder := &recordingTelemetry{}
	_, client := telemetryServer(t, chatshandlers.New(stubService{
		chat: func(_ context.Context, ownerID, chatID string) (models.Chat, []models.Message, string, error) {
			return models.Chat{ID: chatID, UserID: ownerID}, nil, "", nil
		},
	}), recorder)

	if _, err := client.GetChat(context.Background(), getChatRequest()); err != nil {
		t.Fatalf("GetChat: %v", err)
	}

	tracked, statuses, codes, procedures := recorder.snapshot()
	if len(tracked) != 1 || tracked[0] != "/chats.v1.ChatService/GetChat" {
		t.Fatalf("tracked = %v, want the GetChat procedure", tracked)
	}
	if len(procedures) != 1 || procedures[0] != "/chats.v1.ChatService/GetChat" {
		t.Fatalf("recorded procedures = %v, want the GetChat procedure", procedures)
	}
	if len(codes) != 1 || codes[0] != observability.RPCStatusOK {
		t.Fatalf("recorded codes = %v, want the ok code", codes)
	}
	if len(statuses) != 1 || statuses[0] != observability.RPCStatusOK {
		t.Fatalf("span statuses = %v, want the ok status", statuses)
	}
}

func TestTheInterceptorRecordsTheFailingCode(t *testing.T) {
	recorder := &recordingTelemetry{}
	_, client := telemetryServer(t, chatshandlers.New(stubService{
		chat: func(context.Context, string, string) (models.Chat, []models.Message, string, error) {
			return models.Chat{}, nil, "", errors.New("boom")
		},
	}), recorder)

	if _, err := client.GetChat(context.Background(), getChatRequest()); err == nil {
		t.Fatal("GetChat answered without an error, want the stub's failure")
	}

	_, statuses, codes, _ := recorder.snapshot()
	if len(codes) != 1 {
		t.Fatalf("recorded codes = %v, want one code", codes)
	}
	if codes[0] == observability.RPCStatusOK {
		t.Error("the failing call recorded the ok code, want the failure's code")
	}
	if len(statuses) != 1 || statuses[0] != codes[0] {
		t.Errorf("span statuses = %v, want the recorded code %q", statuses, codes[0])
	}
}

// A panic must still close the span and count the call, or the crash is
// invisible to the telemetry.
func TestTheInterceptorRecordsAPanicAsAnInternalFailure(t *testing.T) {
	recorder := &recordingTelemetry{}
	server, client := telemetryServer(t, chatshandlers.New(stubService{
		chat: func(context.Context, string, string) (models.Chat, []models.Message, string, error) {
			panic("boom")
		},
	}), recorder)

	// The server drops the connection on the panic, so the call itself fails.
	if _, err := client.GetChat(context.Background(), getChatRequest()); err == nil {
		t.Fatal("GetChat answered without an error, want the panic to fail the call")
	}
	// Closing waits for the outstanding request, so the recorder is settled.
	server.Close()

	_, statuses, codes, _ := recorder.snapshot()
	if len(codes) != 1 || codes[0] != observability.RPCStatusInternal {
		t.Fatalf("recorded codes = %v, want one internal code", codes)
	}
	if len(statuses) != 1 || statuses[0] != observability.RPCStatusInternal {
		t.Fatalf("span statuses = %v, want the internal status", statuses)
	}
}
