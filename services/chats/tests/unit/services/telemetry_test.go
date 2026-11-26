package services_test

import (
	"context"
	"errors"
	"log/slog"
	"testing"
	"time"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/cache/coalescer"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/cache/lock"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/models"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/observability"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/services"
)

type recordingTelemetry struct {
	operations []string
	results    []observability.CacheResult
	rejections []string
}

var _ observability.Telemetry = (*recordingTelemetry)(nil)

func (r *recordingTelemetry) TrackRPC(ctx context.Context, _ string) (context.Context, func(observability.RPCStatus)) {
	return ctx, func(observability.RPCStatus) {}
}

func (r *recordingTelemetry) RecordRPC(string, observability.RPCStatus, time.Duration) {}

func (r *recordingTelemetry) RecordCacheOp(operation string, result observability.CacheResult, _ time.Duration) {
	r.operations = append(r.operations, operation)
	r.results = append(r.results, result)
}

func (r *recordingTelemetry) RecordDatastoreOp(string, observability.DatastoreResult, time.Duration) {
}

func (r *recordingTelemetry) RecordRateLimitRefusal(string) {}

func (r *recordingTelemetry) RecordValidationRejection(field string) {
	r.rejections = append(r.rejections, field)
}

func (r *recordingTelemetry) Shutdown(context.Context) error { return nil }

type cacheOp struct {
	operation string
	result    observability.CacheResult
}

func newRecordingService(repo *fakeRepository, entries *fakeCache) (*services.ChatService, *recordingTelemetry) {
	recorder := &recordingTelemetry{}
	service := services.NewChatService(repo, entries, lock.Null{}, coalescer.NewFlightGroup(), testPolicy(), slog.New(slog.DiscardHandler), recorder)
	return service, recorder
}

func readingRepo() *fakeRepository {
	return &fakeRepository{
		chat: func(_ context.Context, ownerID, chatID string) (models.Chat, error) {
			return models.Chat{ID: chatID, UserID: ownerID, Title: "a title"}, nil
		},
		chatHistory: func(_ context.Context, _ string, chatID string, _ string, _ int) ([]models.Message, string, error) {
			return []models.Message{{ID: "m1", ChatID: chatID}}, "", nil
		},
	}
}

func TestTheServiceRecordsEveryCacheOperationItMakes(t *testing.T) {
	service, recorder := newRecordingService(readingRepo(), newFakeCache())

	for range 2 {
		if _, _, _, err := service.GetChat(context.Background(), "owner-1", "chat-1"); err != nil {
			t.Fatalf("GetChat: %v", err)
		}
	}

	// A cold fill reads the cache twice: once before the lock and once inside
	// it, so the winner never repeats a fill another caller already finished.
	// Each of those misses also consults the negative marker.
	want := []cacheOp{
		{observability.CacheOperationChat, observability.CacheMiss},
		{observability.CacheOperationNegative, observability.CacheMiss},
		{observability.CacheOperationChat, observability.CacheMiss},
		{observability.CacheOperationNegative, observability.CacheMiss},
		{observability.CacheOperationPutChat, observability.CacheOK},
		{observability.CacheOperationHead, observability.CacheMiss},
		{observability.CacheOperationHead, observability.CacheMiss},
		{observability.CacheOperationPutHead, observability.CacheOK},
		{observability.CacheOperationChat, observability.CacheHit},
		{observability.CacheOperationHead, observability.CacheHit},
	}
	if len(recorder.operations) != len(want) {
		t.Fatalf("cache operations = %v, want %v", recorder.operations, want)
	}
	for index, expected := range want {
		if recorder.operations[index] != expected.operation || recorder.results[index] != expected.result {
			t.Errorf("cache operation %d = %s/%s, want %s/%s", index,
				recorder.operations[index], recorder.results[index], expected.operation, expected.result)
		}
	}
}

func TestTheServiceRecordsAnAbsorbedCacheFault(t *testing.T) {
	entries := newFakeCache()
	entries.readErr = errors.New("redis is down")
	service, recorder := newRecordingService(readingRepo(), entries)

	if _, _, _, err := service.GetChat(context.Background(), "owner-1", "chat-1"); err != nil {
		t.Fatalf("GetChat: %v", err)
	}

	want := []cacheOp{
		{observability.CacheOperationChat, observability.CacheError},
		{observability.CacheOperationChat, observability.CacheError},
		{observability.CacheOperationPutChat, observability.CacheOK},
		{observability.CacheOperationHead, observability.CacheError},
		{observability.CacheOperationHead, observability.CacheError},
		{observability.CacheOperationPutHead, observability.CacheOK},
	}
	if len(recorder.operations) != len(want) {
		t.Fatalf("cache operations = %v, want %v", recorder.operations, want)
	}
	for index, expected := range want {
		if recorder.operations[index] != expected.operation || recorder.results[index] != expected.result {
			t.Errorf("cache operation %d = %s/%s, want %s/%s", index,
				recorder.operations[index], recorder.results[index], expected.operation, expected.result)
		}
	}
}

func TestTheServiceRecordsTheRejectedField(t *testing.T) {
	service, recorder := newRecordingService(&fakeRepository{}, newFakeCache())

	if _, err := service.CreateChat(context.Background(), "owner-1", "   "); err == nil {
		t.Fatal("CreateChat = nil error, want a validation failure")
	}

	if len(recorder.rejections) != 1 || recorder.rejections[0] != "content" {
		t.Errorf("rejected fields = %v, want [content]", recorder.rejections)
	}
}
