package grpc

import (
	"context"
	"errors"
	"testing"
	"time"

	pb "github.com/kunalPisolkar24/detectAI/services/chats/api/proto"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/core/domain"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/mocks"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
)

func TestCreateChat(t *testing.T) {
	mockService := new(mocks.MockChatService)
	handler := NewHandler(mockService)
	ctx := context.Background()

	req := &pb.CreateChatRequest{
		UserId: "user-1",
		Title:  "Test Chat",
	}

	session := &domain.ChatSession{ID: "chat-uuid"}
	mockService.On("CreateSession", ctx, "user-1", "Test Chat").Return(session, nil)

	resp, err := handler.CreateChat(ctx, req)

	assert.NoError(t, err)
	assert.Equal(t, "chat-uuid", resp.ChatId)
	mockService.AssertExpectations(t)
}

func TestCreateChat_MissingUserID(t *testing.T) {
	mockService := new(mocks.MockChatService)
	handler := NewHandler(mockService)
	ctx := context.Background()

	req := &pb.CreateChatRequest{Title: "Test Chat"}

	_, err := handler.CreateChat(ctx, req)

	assert.Error(t, err)
	mockService.AssertNotCalled(t, "CreateSession")
}

func TestSaveMessage(t *testing.T) {
	mockService := new(mocks.MockChatService)
	handler := NewHandler(mockService)
	ctx := context.Background()

	req := &pb.SaveMessageRequest{
		ChatId:  "chat-1",
		UserId:  "user-1",
		Content: "Hello",
		Role:    "user",
		Analysis: &pb.Analysis{
			HumanScore: 0.9,
			AiScore:    0.1,
			ModelName:  "gpt-4",
			Verdict:    "human",
		},
	}

	mockService.On("ProcessMessage", ctx, mock.MatchedBy(func(msg *domain.Message) bool {
		return msg.ChatID == "chat-1" && 
			msg.Analysis.HumanScore == 0.9 &&
			msg.Analysis.Verdict == "human"
	})).Run(func(args mock.Arguments) {
		msg := args.Get(1).(*domain.Message)
		msg.ID = "msg-uuid"
		msg.CreatedAt = time.Now()
	}).Return(nil)

	resp, err := handler.SaveMessage(ctx, req)

	assert.NoError(t, err)
	assert.Equal(t, "msg-uuid", resp.MessageId)
	assert.NotZero(t, resp.Timestamp)
	mockService.AssertExpectations(t)
}

func TestGetChatHistory(t *testing.T) {
	mockService := new(mocks.MockChatService)
	handler := NewHandler(mockService)
	ctx := context.Background()

	req := &pb.GetChatHistoryRequest{
		ChatId:   "chat-1",
		Page:     1,
		PageSize: 10,
	}

	msgs := []*domain.Message{
		{
			ID:      "msg-1",
			Content: "Hi",
			Analysis: &domain.AnalysisResult{
				Verdict: "human",
			},
			CreatedAt: time.Now(),
		},
	}

	mockService.On("GetHistory", ctx, "chat-1", int32(1), int32(10)).Return(msgs, true, nil)

	resp, err := handler.GetChatHistory(ctx, req)

	assert.NoError(t, err)
	assert.True(t, resp.HasMore)
	assert.Len(t, resp.Messages, 1)
	assert.Equal(t, "msg-1", resp.Messages[0].Id)
	assert.Equal(t, "human", resp.Messages[0].Analysis.Verdict)
	mockService.AssertExpectations(t)
}

func TestGetChatHistory_Error(t *testing.T) {
	mockService := new(mocks.MockChatService)
	handler := NewHandler(mockService)
	ctx := context.Background()

	req := &pb.GetChatHistoryRequest{ChatId: "chat-1"}

	mockService.On("GetHistory", ctx, "chat-1", int32(0), int32(0)).Return(nil, false, errors.New("db error"))

	_, err := handler.GetChatHistory(ctx, req)

	assert.Error(t, err)
	mockService.AssertExpectations(t)
}