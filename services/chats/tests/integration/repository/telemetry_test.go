package repository_test

import (
	"context"
	"testing"
	"time"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/models"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/observability"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/repository"
)

// recordingTelemetry captures what the repository reports to the seam.
type recordingTelemetry struct {
	operations []string
	results    []observability.DatastoreResult
}

var _ observability.Telemetry = (*recordingTelemetry)(nil)

func (r *recordingTelemetry) TrackRPC(ctx context.Context, _ string) (context.Context, func(observability.RPCStatus)) {
	return ctx, func(observability.RPCStatus) {}
}

func (r *recordingTelemetry) RecordRPC(string, observability.RPCStatus, time.Duration) {}

func (r *recordingTelemetry) RecordCacheOp(string, observability.CacheResult, time.Duration) {}

func (r *recordingTelemetry) RecordDatastoreOp(operation string, result observability.DatastoreResult, _ time.Duration) {
	r.operations = append(r.operations, operation)
	r.results = append(r.results, result)
}

func (r *recordingTelemetry) RecordRateLimitRefusal(string)    {}
func (r *recordingTelemetry) RecordValidationRejection(string) {}

func (r *recordingTelemetry) Shutdown(context.Context) error { return nil }

// datastoreOp is one recorded datastore operation.
type datastoreOp struct {
	operation string
	result    observability.DatastoreResult
}

func TestTheRepositoryRecordsEveryOperationAndItsOutcome(t *testing.T) {
	recorder := &recordingTelemetry{}
	repo, err := repository.New(testContext(t), connectContainer(t).Database(), recorder)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	ownerID := owner()

	chat, err := repo.CreateChat(testContext(t), ownerID, "a title")
	if err != nil {
		t.Fatalf("CreateChat: %v", err)
	}
	if _, err := repo.Chat(testContext(t), ownerID, chat.ID); err != nil {
		t.Fatalf("Chat: %v", err)
	}
	if _, err := repo.Chat(testContext(t), ownerID, "missing-chat"); err == nil {
		t.Fatal("Chat answered without an error, want the missing chat refused")
	}

	want := []datastoreOp{
		{observability.DatastoreOperationCreateChat, observability.DatastoreOK},
		{observability.DatastoreOperationChat, observability.DatastoreOK},
		{observability.DatastoreOperationChat, observability.DatastoreNotFound},
	}
	if len(recorder.operations) != len(want) {
		t.Fatalf("datastore operations = %v, want %v", recorder.operations, want)
	}
	for index, expected := range want {
		if recorder.operations[index] != expected.operation || recorder.results[index] != expected.result {
			t.Errorf("datastore operation %d = %s/%s, want %s/%s", index,
				recorder.operations[index], recorder.results[index], expected.operation, expected.result)
		}
	}
}

func TestTheRepositoryRecordsAConflictOutcome(t *testing.T) {
	recorder := &recordingTelemetry{}
	repo, err := repository.New(testContext(t), connectContainer(t).Database(), recorder)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	ownerID := owner()
	chat, err := repo.CreateChat(testContext(t), ownerID, "a title")
	if err != nil {
		t.Fatalf("CreateChat: %v", err)
	}
	id := "analysis-1"

	if _, err := repo.SaveAnalysisMessage(testContext(t), ownerID, models.Message{
		ID:     id,
		ChatID: chat.ID,
		Role:   models.RoleAssistant,
		Analysis: &models.Analysis{
			State:           models.StateCompleted,
			Model:           models.ModelSpark,
			SourceMessageID: "m1",
			Result: &models.AnalysisResult{
				Label:      models.LabelAI,
				Confidence: 0.9,
				Scores:     models.Scores{AI: 0.9, Human: 0.1},
			},
		},
	}); err != nil {
		t.Fatalf("SaveAnalysisMessage: %v", err)
	}

	if _, err := repo.SaveAnalysisMessage(testContext(t), ownerID, models.Message{
		ID:     id,
		ChatID: chat.ID,
		Role:   models.RoleAssistant,
		Analysis: &models.Analysis{
			State:           models.StateCompleted,
			Model:           models.ModelSpark,
			SourceMessageID: "m1",
			Result: &models.AnalysisResult{
				Label:      models.LabelHuman,
				Confidence: 0.2,
				Scores:     models.Scores{AI: 0.2, Human: 0.8},
			},
		},
	}); err == nil {
		t.Fatal("the terminal write answered without an error, want the conflict refused")
	}

	last := datastoreOp{recorder.operations[len(recorder.operations)-1], recorder.results[len(recorder.results)-1]}
	want := datastoreOp{observability.DatastoreOperationSaveAnalysisMessage, observability.DatastoreConflict}
	if last != want {
		t.Errorf("the last operation = %+v, want %+v", last, want)
	}
}
