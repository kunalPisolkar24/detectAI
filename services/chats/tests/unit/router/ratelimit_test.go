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

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/cache/limiter"
	"github.com/kunalPisolkar24/detectAI/services/chats/proto"
	chatv1connect "github.com/kunalPisolkar24/detectAI/services/chats/proto/chatv1connect"
)

type allowAllLimiter struct{}

func (allowAllLimiter) Consume(context.Context, string, string, int) (limiter.Decision, error) {
	return limiter.Decision{Allowed: true}, nil
}

type stubLimiter struct {
	err       error
	decision  limiter.Decision
	decisions []limiter.Decision
	owners    []string
	scopes    []string
	limits    []int
}

func (l *stubLimiter) Consume(_ context.Context, ownerID, scope string, limit int) (limiter.Decision, error) {
	l.owners = append(l.owners, ownerID)
	l.scopes = append(l.scopes, scope)
	l.limits = append(l.limits, limit)
	if l.err != nil {
		return limiter.Decision{}, l.err
	}
	if len(l.decisions) > 0 {
		decision := l.decisions[0]
		l.decisions = l.decisions[1:]
		return decision, nil
	}
	return l.decision, nil
}

func authenticated[T any](msg *T) *connect.Request[T] {
	req := connect.NewRequest(msg)
	req.Header().Set("x-api-key", testAPIKey)
	req.Header().Set("x-user-id", "owner-1")
	return req
}

func TestEveryProcedureDrawsFromItsScope(t *testing.T) {
	stub := &stubLimiter{decision: limiter.Decision{Allowed: true}}
	srv := newServerWithLimiter(t, fakeDatabase{}, stubService{}, stub)
	client := chatv1connect.NewChatServiceClient(srv.Client(), srv.URL)
	ctx := context.Background()

	calls := []struct {
		name string
		call func() error
	}{
		{"CreateChat", func() error {
			_, err := client.CreateChat(ctx, authenticated(&chatv1.CreateChatRequest{InitialMessage: "hello"}))
			return err
		}},
		{"GetChat", func() error {
			_, err := client.GetChat(ctx, authenticated(&chatv1.GetChatRequest{ChatId: "chat-1"}))
			return err
		}},
		{"ListChats", func() error {
			_, err := client.ListChats(ctx, authenticated(&chatv1.ListChatsRequest{}))
			return err
		}},
		{"GetChatHistory", func() error {
			_, err := client.GetChatHistory(ctx, authenticated(&chatv1.GetChatHistoryRequest{ChatId: "chat-1"}))
			return err
		}},
		{"RenameChat", func() error {
			_, err := client.RenameChat(ctx, authenticated(&chatv1.RenameChatRequest{ChatId: "chat-1", Title: "new"}))
			return err
		}},
		{"DeleteChat", func() error {
			_, err := client.DeleteChat(ctx, authenticated(&chatv1.DeleteChatRequest{ChatId: "chat-1"}))
			return err
		}},
		{"SaveUserMessage", func() error {
			_, err := client.SaveUserMessage(ctx, authenticated(&chatv1.SaveUserMessageRequest{ChatId: "chat-1", Content: "hi"}))
			return err
		}},
		{"SaveAnalysisMessage", func() error {
			_, err := client.SaveAnalysisMessage(ctx, authenticated(&chatv1.SaveAnalysisMessageRequest{ChatId: "chat-1", MessageId: "message-1"}))
			return err
		}},
	}
	for _, c := range calls {
		if err := c.call(); err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}
	}

	wantScopes := []string{"create", "read", "read", "read", "write", "write", "write", "write"}
	wantLimits := []int{10, 600, 600, 600, 60, 60, 60, 60}
	if len(stub.scopes) != len(wantScopes) {
		t.Fatalf("scopes = %v, want one entry per procedure", stub.scopes)
	}
	for i, scope := range wantScopes {
		if stub.scopes[i] != scope {
			t.Errorf("scope %d = %q, want %q", i, stub.scopes[i], scope)
		}
		if stub.limits[i] != wantLimits[i] {
			t.Errorf("limit %d = %d, want %d", i, stub.limits[i], wantLimits[i])
		}
	}
	for i, owner := range stub.owners {
		if owner != "owner-1" {
			t.Errorf("owner %d = %q, want %q", i, owner, "owner-1")
		}
	}
}

func TestAnOverLimitReadIsRefused(t *testing.T) {
	stub := &stubLimiter{decision: limiter.Decision{Allowed: false, Count: 601, Limit: 600, RetryAfter: 42 * time.Second}}
	srv := newServerWithLimiter(t, fakeDatabase{}, stubService{}, stub)
	client := chatv1connect.NewChatServiceClient(srv.Client(), srv.URL)

	_, err := client.GetChat(context.Background(), authenticated(&chatv1.GetChatRequest{ChatId: "chat-1"}))
	if connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("GetChat code = %v, want %v", connect.CodeOf(err), connect.CodeResourceExhausted)
	}
	if stub.scopes[0] != "read" || stub.limits[0] != 600 {
		t.Errorf("read call used scope %q and limit %d, want read/600", stub.scopes[0], stub.limits[0])
	}

	var connectErr *connect.Error
	if !errors.As(err, &connectErr) {
		t.Fatalf("err = %v, want a connect error", err)
	}
	if got := connectErr.Meta().Get("x-ratelimit-limit"); got != "600" {
		t.Errorf("x-ratelimit-limit = %q, want %q", got, "600")
	}
}

func TestAnOverLimitCallIsRefused(t *testing.T) {
	limiter := &stubLimiter{decision: limiter.Decision{Allowed: false, Count: 11, Limit: 10, RetryAfter: 42 * time.Second}}
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
	limiter := &stubLimiter{decisions: []limiter.Decision{
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
	limiter := &stubLimiter{decision: limiter.Decision{Allowed: true}}
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
