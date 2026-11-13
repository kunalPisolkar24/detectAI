// Package router_test drives the rate-limit surface over the mounted ChatService.
package router_test

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"strconv"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/services"
	"github.com/kunalPisolkar24/detectAI/services/chats/proto"
	chatv1connect "github.com/kunalPisolkar24/detectAI/services/chats/proto/chatv1connect"
)

// allowAllLimiter lets every call through.
type allowAllLimiter struct{}

func (allowAllLimiter) Consume(context.Context, string, string, int) (services.Decision, error) {
	return services.Decision{Allowed: true}, nil
}

// stubLimiter records the checks it answers and returns a fixed outcome.
type stubLimiter struct {
	err       error
	decision  services.Decision
	decisions []services.Decision
	owners    []string
	scopes    []string
	limits    []int
}

func (l *stubLimiter) Consume(_ context.Context, ownerID, scope string, limit int) (services.Decision, error) {
	l.owners = append(l.owners, ownerID)
	l.scopes = append(l.scopes, scope)
	l.limits = append(l.limits, limit)
	if l.err != nil {
		return services.Decision{}, l.err
	}
	if len(l.decisions) > 0 {
		decision := l.decisions[0]
		l.decisions = l.decisions[1:]
		return decision, nil
	}
	return l.decision, nil
}

// authenticated returns a request the auth interceptor accepts.
func authenticated[T any](msg *T) *connect.Request[T] {
	req := connect.NewRequest(msg)
	req.Header().Set("x-api-key", testAPIKey)
	req.Header().Set("x-user-id", "owner-1")
	return req
}

func TestEachScopeDrawsFromItsOwnBudget(t *testing.T) {
	limiter := &stubLimiter{decision: services.Decision{Allowed: true}}
	srv := newServerWithLimiter(t, fakeDatabase{}, stubService{}, limiter)
	client := chatv1connect.NewChatServiceClient(srv.Client(), srv.URL)

	if _, err := client.CreateChat(context.Background(), authenticated(&chatv1.CreateChatRequest{InitialMessage: "hello"})); err != nil {
		t.Fatalf("CreateChat: %v", err)
	}
	if _, err := client.SaveUserMessage(context.Background(), authenticated(&chatv1.SaveUserMessageRequest{ChatId: "chat-1", Content: "hi"})); err != nil {
		t.Fatalf("SaveUserMessage: %v", err)
	}
	if _, err := client.SaveAnalysisMessage(context.Background(), authenticated(&chatv1.SaveAnalysisMessageRequest{ChatId: "chat-1", MessageId: "message-1"})); err != nil {
		t.Fatalf("SaveAnalysisMessage: %v", err)
	}

	wantScopes := []string{"create", "write", "write"}
	wantLimits := []int{10, 60, 60}
	for i, scope := range wantScopes {
		if limiter.scopes[i] != scope {
			t.Errorf("scope %d = %q, want %q", i, limiter.scopes[i], scope)
		}
		if limiter.limits[i] != wantLimits[i] {
			t.Errorf("limit %d = %d, want %d", i, limiter.limits[i], wantLimits[i])
		}
	}
	if limiter.owners[0] != "owner-1" {
		t.Errorf("owner = %q, want %q", limiter.owners[0], "owner-1")
	}
}

func TestAnUnlimitedProcedureIsNeverCounted(t *testing.T) {
	limiter := &stubLimiter{decision: services.Decision{Allowed: true}}
	srv := newServerWithLimiter(t, fakeDatabase{}, stubService{}, limiter)
	client := chatv1connect.NewChatServiceClient(srv.Client(), srv.URL)

	if _, err := client.GetChat(context.Background(), authenticated(&chatv1.GetChatRequest{ChatId: "chat-1"})); err != nil {
		t.Fatalf("GetChat: %v", err)
	}
	if len(limiter.scopes) != 0 {
		t.Errorf("counted %v, want no counted procedure", limiter.scopes)
	}
}

func TestAnOverLimitCallIsRefused(t *testing.T) {
	limiter := &stubLimiter{decision: services.Decision{Allowed: false, Count: 11, Limit: 10, RetryAfter: 42 * time.Second}}
	srv := newServerWithLimiter(t, fakeDatabase{}, stubService{}, limiter)
	client := chatv1connect.NewChatServiceClient(srv.Client(), srv.URL)

	_, err := client.CreateChat(context.Background(), authenticated(&chatv1.CreateChatRequest{InitialMessage: "hello"}))
	if connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("CreateChat code = %v, want %v", connect.CodeOf(err), connect.CodeResourceExhausted)
	}

	var connectErr *connect.Error
	if !errors.As(err, &connectErr) {
		t.Fatalf("err = %v, want a connect error", err)
	}
	meta := connectErr.Meta()
	if got := meta.Get("retry-after-ms"); got != strconv.FormatInt((42*time.Second).Milliseconds(), 10) {
		t.Errorf("retry-after-ms = %q, want %q", got, "42000")
	}
	if got := meta.Get("x-ratelimit-limit"); got != "10" {
		t.Errorf("x-ratelimit-limit = %q, want %q", got, "10")
	}
	if got := meta.Get("x-ratelimit-remaining"); got != "0" {
		t.Errorf("x-ratelimit-remaining = %q, want %q", got, "0")
	}
}

func TestACacheFaultFailsOpen(t *testing.T) {
	limiter := &stubLimiter{err: errors.New("redis: rate limit increment: connection refused")}
	var logs bytes.Buffer
	srv := newServerWithLogger(t, fakeDatabase{}, stubService{}, limiter, slog.New(slog.NewTextHandler(&logs, nil)))
	client := chatv1connect.NewChatServiceClient(srv.Client(), srv.URL)

	if _, err := client.CreateChat(context.Background(), authenticated(&chatv1.CreateChatRequest{InitialMessage: "hello"})); err != nil {
		t.Fatalf("CreateChat: %v", err)
	}
	if !strings.Contains(logs.String(), "rate limit check failed open") {
		t.Errorf("the fault was not logged: %s", logs.String())
	}
	if strings.Contains(logs.String(), "owner-1") {
		t.Errorf("the log carries the raw owner id: %s", logs.String())
	}
}

func TestARefusalIsLoggedOncePerWindow(t *testing.T) {
	limiter := &stubLimiter{decisions: []services.Decision{
		{Allowed: false, Count: 11, Limit: 10, RetryAfter: 42 * time.Second},
		{Allowed: false, Count: 12, Limit: 10, RetryAfter: 41 * time.Second},
	}}
	var logs bytes.Buffer
	srv := newServerWithLogger(t, fakeDatabase{}, stubService{}, limiter, slog.New(slog.NewTextHandler(&logs, nil)))
	client := chatv1connect.NewChatServiceClient(srv.Client(), srv.URL)

	for attempt := 0; attempt < 2; attempt++ {
		_, err := client.CreateChat(context.Background(), authenticated(&chatv1.CreateChatRequest{InitialMessage: "hello"}))
		if connect.CodeOf(err) != connect.CodeResourceExhausted {
			t.Fatalf("CreateChat code = %v, want %v", connect.CodeOf(err), connect.CodeResourceExhausted)
		}
	}

	if got := strings.Count(logs.String(), "rate limit refused"); got != 1 {
		t.Errorf("refusal log lines = %d, want exactly one: %s", got, logs.String())
	}
	if strings.Contains(logs.String(), "owner-1") {
		t.Errorf("the log carries the raw owner id: %s", logs.String())
	}
}

func TestAnUnauthenticatedCallIsNeverCounted(t *testing.T) {
	limiter := &stubLimiter{decision: services.Decision{Allowed: true}}
	srv := newServerWithLimiter(t, fakeDatabase{}, stubService{}, limiter)
	client := chatv1connect.NewChatServiceClient(srv.Client(), srv.URL)

	req := connect.NewRequest(&chatv1.CreateChatRequest{InitialMessage: "hello"})
	req.Header().Set("x-user-id", "owner-1")

	_, err := client.CreateChat(context.Background(), req)
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("CreateChat code = %v, want %v", connect.CodeOf(err), connect.CodeUnauthenticated)
	}
	if len(limiter.scopes) != 0 {
		t.Errorf("counted %v, want no counted procedure", limiter.scopes)
	}
}
