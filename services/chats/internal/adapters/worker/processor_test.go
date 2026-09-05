package worker

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/go-redis/redismock/v9"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/core/domain"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/mocks"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"go.uber.org/zap"
)

func TestProcessBatch_EndToEnd(t *testing.T) {
	db, mockRedis := redismock.NewClusterMock()
	mockRepo := new(mocks.MockChatPersistenceRepository)
	mockMetrics := new(mocks.MockMetricsCollector)

	processor := NewProcessor(mockRepo, zap.NewNop(), mockMetrics)
	ctx := context.Background()

	msg := domain.Message{ID: "msg-1", ChatID: "chat-1", Content: "Test"}
	msgData, _ := json.Marshal(msg)

	streams := []redis.XStream{
		{
			Stream: "stream-1",
			Messages: []redis.XMessage{
				{ID: "1-0", Values: map[string]interface{}{"data": string(msgData)}},
				{ID: "2-0", Values: map[string]interface{}{"data": "bad-json"}},
			},
		},
	}

	mockRepo.On("BulkUpsertMessages", ctx, mock.MatchedBy(func(msgs []*domain.Message) bool {
		return len(msgs) == 1 && msgs[0].ID == "msg-1"
	})).Return(nil)

	mockMetrics.On("AddIngestedMessages", 1.0).Return()
	mockMetrics.On("IncStreamErrors", "unmarshal").Return()

	mockRedis.ExpectXAck("stream-1", "test-group", "1-0", "2-0").SetVal(2)

	processor.ProcessBatch(ctx, streams, db, "test-group")

	mockRepo.AssertExpectations(t)
	mockMetrics.AssertExpectations(t)
	if err := mockRedis.ExpectationsWereMet(); err != nil {
		t.Error(err)
	}
}

func TestProcessBatch_DBFailure_MovesToDLQ(t *testing.T) {
	db, mockRedis := redismock.NewClusterMock()
	mockRepo := new(mocks.MockChatPersistenceRepository)
	mockMetrics := new(mocks.MockMetricsCollector)
	processor := NewProcessor(mockRepo, zap.NewNop(), mockMetrics)
	ctx := context.Background()

	msg := domain.Message{ID: "msg-1", ChatID: "chat-1", Content: "hello"}
	msgData, _ := json.Marshal(msg)

	streams := []redis.XStream{
		{
			Stream: "stream-1",
			Messages: []redis.XMessage{
				{ID: "1-0", Values: map[string]interface{}{"data": string(msgData)}},
			},
		},
	}

	mockRepo.On("BulkUpsertMessages", ctx, mock.Anything).Return(assert.AnError)
	mockMetrics.On("IncDatabaseErrors", "bulk_upsert").Return()
	mockMetrics.On("IncStreamErrors", mock.Anything).Return().Maybe()
	mockMetrics.On("IncDLQMessages", mock.Anything).Return()

	// Expect DLQ SAdd + XAck + Expire via pipeline (Expire once after loop)
	mockRedis.ExpectSAdd("chat:dlq:messages", "1-0").SetVal(1)
	mockRedis.ExpectXAck("stream-1", "test-group", "1-0").SetVal(1)
	mockRedis.ExpectExpire("chat:dlq:messages", 7*24*time.Hour).SetVal(true)

	processor.ProcessBatch(ctx, streams, db, "test-group")

	mockRepo.AssertExpectations(t)
	mockMetrics.AssertNotCalled(t, "AddIngestedMessages", mock.Anything)
	if err := mockRedis.ExpectationsWereMet(); err != nil {
		t.Error(err)
	}
}

func TestProcessBatch_AllPoison_Acks(t *testing.T) {
	db, mockRedis := redismock.NewClusterMock()
	mockRepo := new(mocks.MockChatPersistenceRepository)
	mockMetrics := new(mocks.MockMetricsCollector)
	processor := NewProcessor(mockRepo, zap.NewNop(), mockMetrics)
	ctx := context.Background()

	streams := []redis.XStream{
		{
			Stream: "stream-1",
			Messages: []redis.XMessage{
				{ID: "1-0", Values: map[string]interface{}{"data": "bad-json"}},
				{ID: "2-0", Values: map[string]interface{}{"missing": "field"}},
			},
		},
	}

	mockMetrics.On("IncStreamErrors", mock.Anything).Return()

	mockRedis.ExpectXAck("stream-1", "test-group", "1-0", "2-0").SetVal(2)

	processor.ProcessBatch(ctx, streams, db, "test-group")

	mockRepo.AssertNotCalled(t, "BulkUpsertMessages", mock.Anything)
	if err := mockRedis.ExpectationsWereMet(); err != nil {
		t.Error(err)
	}
}

func TestProcessBatch_BytesPayload(t *testing.T) {
	db, mockRedis := redismock.NewClusterMock()
	mockRepo := new(mocks.MockChatPersistenceRepository)
	mockMetrics := new(mocks.MockMetricsCollector)
	processor := NewProcessor(mockRepo, zap.NewNop(), mockMetrics)
	ctx := context.Background()

	msg := domain.Message{ID: "msg-1", ChatID: "chat-1", Content: "Test"}
	msgData, _ := json.Marshal(msg)

	streams := []redis.XStream{
		{
			Stream: "stream-1",
			Messages: []redis.XMessage{
				{ID: "1-0", Values: map[string]interface{}{"data": msgData}}, // []byte
			},
		},
	}

	mockRepo.On("BulkUpsertMessages", ctx, mock.Anything).Return(nil)
	mockMetrics.On("AddIngestedMessages", 1.0).Return()
	mockRedis.ExpectXAck("stream-1", "test-group", "1-0").SetVal(1)

	processor.ProcessBatch(ctx, streams, db, "test-group")

	mockRepo.AssertExpectations(t)
	if err := mockRedis.ExpectationsWereMet(); err != nil {
		t.Error(err)
	}
}
