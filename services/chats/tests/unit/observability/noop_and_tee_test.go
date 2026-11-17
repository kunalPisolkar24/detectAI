package observability_test

import (
	"context"
	"log/slog"
	"testing"
	"time"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/observability"
)

func TestNullTelemetryAcceptsEveryRecordingCall(t *testing.T) {
	tel := observability.NullTelemetry{}

	ctx, end := tel.TrackRPC(t.Context(), "/chats.v1.ChatService/GetChat")
	if ctx == nil || end == nil {
		t.Fatal("TrackRPC returned nils")
	}
	end(observability.RPCStatusOK)
	tel.RecordRPC("/chats.v1.ChatService/GetChat", observability.RPCStatusInternal, time.Millisecond)
	tel.RecordCacheOp(observability.CacheOperationChat, observability.CacheMiss, time.Millisecond)
	tel.RecordDatastoreOp(observability.DatastoreOperationChat, observability.DatastoreUnavailable, time.Millisecond)
	tel.RecordRateLimitRefusal("create")
	tel.RecordValidationRejection("title")
}

func TestWiredLoggerForwardsAttrsAndGroups(t *testing.T) {
	receiver := newOTLPReceiver(t)
	tel, err := observability.Boot(wiredConfig(receiver.endpoint), "dev")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = tel.Shutdown(t.Context()) })

	slog.Default().With("scope", "tee").WithGroup("nested").Info("attrs and groups reach both handlers", "key", "value")

	drain, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := tel.Shutdown(drain); err != nil {
		t.Fatalf("Shutdown: %v", err)
	}
	if receiver.hits("/v1/logs") == 0 {
		t.Error("the receiver never saw the log emitted through WithAttrs and WithGroup")
	}
}
