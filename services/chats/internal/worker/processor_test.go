package worker

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/go-redis/redismock/v9"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/core/domain"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/mocks"
	"github.com/kunalPisolkar24/detectAI/services/chats/pkg/logger"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
)

func init() {
	logger.Init("test")
}

func TestProcessBatch_EndToEnd(t *testing.T) {
	db, mockRedis := redismock.NewClusterMock()
	mockRepo := new(mocks.MockChatPersistenceRepository)

	processor := NewProcessor(mockRepo, 50)
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

	mockRedis.ExpectXAck("stream-1", "test-group", "1-0", "2-0").SetVal(2)

	processor.ProcessBatch(ctx, streams, db, "test-group")

	mockRepo.AssertExpectations(t)
	if err := mockRedis.ExpectationsWereMet(); err != nil {
		t.Error(err)
	}
}

func TestProcessBatch_DBFailure_NoAck(t *testing.T) {
	db, mockRedis := redismock.NewClusterMock()
	mockRepo := new(mocks.MockChatPersistenceRepository)
	processor := NewProcessor(mockRepo, 50)
	ctx := context.Background()

	msg := domain.Message{ID: "msg-1"}
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

	processor.ProcessBatch(ctx, streams, db, "test-group")

	mockRepo.AssertExpectations(t)
	if err := mockRedis.ExpectationsWereMet(); err != nil {
		t.Error(err)
	}
}