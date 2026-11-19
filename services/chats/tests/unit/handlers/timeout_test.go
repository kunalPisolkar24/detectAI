package handlers_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"connectrpc.com/connect"

	chatshandlers "github.com/kunalPisolkar24/detectAI/services/chats/internal/handlers"
	chatv1 "github.com/kunalPisolkar24/detectAI/services/chats/proto"
)

func TestTimeoutInterceptorEndsABlockedCall(t *testing.T) {
	interceptor := chatshandlers.NewTimeoutInterceptor(20 * time.Millisecond)
	released := make(chan struct{})
	next := func(ctx context.Context, _ connect.AnyRequest) (connect.AnyResponse, error) {
		<-ctx.Done()
		close(released)
		return nil, ctx.Err()
	}

	_, err := interceptor(next)(context.Background(), connect.NewRequest(&chatv1.GetChatRequest{}))
	if connect.CodeOf(err) != connect.CodeDeadlineExceeded {
		t.Errorf("code = %v, want deadline exceeded", connect.CodeOf(err))
	}
	select {
	case <-released:
	default:
		t.Error("the inner call was not released by the deadline")
	}
}

func TestTimeoutInterceptorPassesOtherErrorsThrough(t *testing.T) {
	want := errors.New("boom")
	interceptor := chatshandlers.NewTimeoutInterceptor(time.Second)
	next := func(context.Context, connect.AnyRequest) (connect.AnyResponse, error) {
		return nil, want
	}

	_, err := interceptor(next)(context.Background(), connect.NewRequest(&chatv1.GetChatRequest{}))
	if !errors.Is(err, want) {
		t.Errorf("err = %v, want the inner error unchanged", err)
	}
}
