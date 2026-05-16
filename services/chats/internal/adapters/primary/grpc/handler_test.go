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
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

func ctxWithUserID(userID string) context.Context {
	md := metadata.Pairs("x-user-id", userID)
	return metadata.NewIncomingContext(context.Background(), md)
}

// --- CreateChat ---

func TestCreateChat_Success(t *testing.T) {
	svc := new(mocks.MockChatService)
	h := NewHandler(svc)
	ctx := context.Background()

	svc.On("CreateSession", ctx, "user-1", "Test Chat").Return(&domain.ChatSession{ID: "chat-uuid"}, nil)

	resp, err := h.CreateChat(ctx, &pb.CreateChatRequest{UserId: "user-1", Title: "Test Chat"})

	assert.NoError(t, err)
	assert.Equal(t, "chat-uuid", resp.ChatId)
	svc.AssertExpectations(t)
}

func TestCreateChat_ServiceError(t *testing.T) {
	svc := new(mocks.MockChatService)
	h := NewHandler(svc)
	ctx := context.Background()

	svc.On("CreateSession", ctx, "", "title").Return(nil, domain.ErrInvalidInput)

	_, err := h.CreateChat(ctx, &pb.CreateChatRequest{UserId: "", Title: "title"})

	assert.Error(t, err)
	st, _ := status.FromError(err)
	assert.Equal(t, codes.InvalidArgument, st.Code())
}

// --- GetChat ---

func TestGetChat_Success(t *testing.T) {
	svc := new(mocks.MockChatService)
	h := NewHandler(svc)
	ctx := ctxWithUserID("user-1")

	now := time.Now().UTC()
	mockChat := &domain.ChatSession{ID: "chat-1", UserID: "user-1", Title: "My Chat", CreatedAt: now, UpdatedAt: now}
	svc.On("GetSession", ctx, "chat-1", "user-1").Return(mockChat, nil)

	resp, err := h.GetChat(ctx, &pb.GetChatRequest{ChatId: "chat-1"})

	assert.NoError(t, err)
	assert.Equal(t, "chat-1", resp.Id)
	assert.Equal(t, "My Chat", resp.Title)
}

func TestGetChat_Unauthorized(t *testing.T) {
	svc := new(mocks.MockChatService)
	h := NewHandler(svc)
	ctx := ctxWithUserID("intruder")

	svc.On("GetSession", ctx, "chat-1", "intruder").Return(nil, domain.ErrUnauthorized)

	_, err := h.GetChat(ctx, &pb.GetChatRequest{ChatId: "chat-1"})

	assert.Error(t, err)
	st, _ := status.FromError(err)
	assert.Equal(t, codes.PermissionDenied, st.Code())
}

func TestGetChat_NotFound(t *testing.T) {
	svc := new(mocks.MockChatService)
	h := NewHandler(svc)
	ctx := ctxWithUserID("user-1")

	svc.On("GetSession", ctx, "missing", "user-1").Return(nil, domain.ErrNotFound)

	_, err := h.GetChat(ctx, &pb.GetChatRequest{ChatId: "missing"})

	assert.Error(t, err)
	st, _ := status.FromError(err)
	assert.Equal(t, codes.NotFound, st.Code())
}

// --- GetUserChats ---

func TestGetUserChats_Success(t *testing.T) {
	svc := new(mocks.MockChatService)
	h := NewHandler(svc)
	ctx := context.Background()

	sessions := []*domain.ChatSession{
		{ID: "c1", Title: "First", UpdatedAt: time.Now()},
		{ID: "c2", Title: "Second", UpdatedAt: time.Now()},
	}
	svc.On("GetUserSessions", ctx, "user-1").Return(sessions, nil)

	resp, err := h.GetUserChats(ctx, &pb.GetUserChatsRequest{UserId: "user-1"})

	assert.NoError(t, err)
	assert.Len(t, resp.Chats, 2)
	assert.Equal(t, "c1", resp.Chats[0].Id)
	assert.Equal(t, "First", resp.Chats[0].Title)
	svc.AssertExpectations(t)
}

func TestGetUserChats_ServiceError(t *testing.T) {
	svc := new(mocks.MockChatService)
	h := NewHandler(svc)
	ctx := context.Background()

	svc.On("GetUserSessions", ctx, "").Return(nil, domain.ErrInvalidInput)

	_, err := h.GetUserChats(ctx, &pb.GetUserChatsRequest{UserId: ""})

	assert.Error(t, err)
	st, _ := status.FromError(err)
	assert.Equal(t, codes.InvalidArgument, st.Code())
}

// --- RenameChat ---

func TestRenameChat_Success(t *testing.T) {
	svc := new(mocks.MockChatService)
	h := NewHandler(svc)
	ctx := ctxWithUserID("user-1")

	svc.On("RenameSession", ctx, "chat-1", "user-1", "New Name").Return(nil)

	resp, err := h.RenameChat(ctx, &pb.RenameChatRequest{ChatId: "chat-1", NewTitle: "New Name"})

	assert.NoError(t, err)
	assert.True(t, resp.Success)
	svc.AssertExpectations(t)
}

func TestRenameChat_Unauthorized(t *testing.T) {
	svc := new(mocks.MockChatService)
	h := NewHandler(svc)
	ctx := ctxWithUserID("intruder")

	svc.On("RenameSession", ctx, "chat-1", "intruder", "New Name").Return(domain.ErrUnauthorized)

	_, err := h.RenameChat(ctx, &pb.RenameChatRequest{ChatId: "chat-1", NewTitle: "New Name"})

	assert.Error(t, err)
	st, _ := status.FromError(err)
	assert.Equal(t, codes.PermissionDenied, st.Code())
}

// --- DeleteChat ---

func TestDeleteChat_Success(t *testing.T) {
	svc := new(mocks.MockChatService)
	h := NewHandler(svc)
	ctx := ctxWithUserID("user-1")

	svc.On("DeleteSession", ctx, "chat-1", "user-1").Return(nil)

	resp, err := h.DeleteChat(ctx, &pb.DeleteChatRequest{ChatId: "chat-1"})

	assert.NoError(t, err)
	assert.True(t, resp.Success)
	svc.AssertExpectations(t)
}

func TestDeleteChat_Unauthorized(t *testing.T) {
	svc := new(mocks.MockChatService)
	h := NewHandler(svc)
	ctx := ctxWithUserID("intruder")

	svc.On("DeleteSession", ctx, "chat-1", "intruder").Return(domain.ErrUnauthorized)

	_, err := h.DeleteChat(ctx, &pb.DeleteChatRequest{ChatId: "chat-1"})

	assert.Error(t, err)
	st, _ := status.FromError(err)
	assert.Equal(t, codes.PermissionDenied, st.Code())
}

// --- SaveMessage ---

func TestSaveMessage_Success(t *testing.T) {
	svc := new(mocks.MockChatService)
	h := NewHandler(svc)
	ctx := context.Background()

	svc.On("ProcessMessage", ctx, mock.MatchedBy(func(m *domain.Message) bool {
		return m.ChatID == "chat-1" && m.Content == "Hello"
	})).Run(func(args mock.Arguments) {
		msg := args.Get(1).(*domain.Message)
		msg.ID = "msg-uuid"
		msg.CreatedAt = time.Now()
	}).Return(nil)

	resp, err := h.SaveMessage(ctx, &pb.SaveMessageRequest{
		ChatId:  "chat-1",
		UserId:  "user-1",
		Content: "Hello",
		Role:    "user",
	})

	assert.NoError(t, err)
	assert.Equal(t, "msg-uuid", resp.MessageId)
	assert.NotZero(t, resp.Timestamp)
}

func TestSaveMessage_ServiceError(t *testing.T) {
	svc := new(mocks.MockChatService)
	h := NewHandler(svc)
	ctx := context.Background()

	svc.On("ProcessMessage", ctx, mock.Anything).Return(domain.ErrInvalidInput)

	_, err := h.SaveMessage(ctx, &pb.SaveMessageRequest{ChatId: "chat-1", UserId: "user-1", Content: "hi", Role: "user"})

	assert.Error(t, err)
	st, _ := status.FromError(err)
	assert.Equal(t, codes.InvalidArgument, st.Code())
}

// --- GetChatHistory ---

func TestGetChatHistory_Success(t *testing.T) {
	svc := new(mocks.MockChatService)
	h := NewHandler(svc)
	ctx := ctxWithUserID("user-1")

	msgs := []*domain.Message{
		{ID: "msg-1", Content: "Hi", Analysis: &domain.AnalysisResult{Verdict: "human"}, CreatedAt: time.Now()},
	}
	svc.On("GetHistory", ctx, "chat-1", "user-1", int32(1), int32(10)).Return(msgs, true, nil)

	resp, err := h.GetChatHistory(ctx, &pb.GetChatHistoryRequest{ChatId: "chat-1", Page: 1, PageSize: 10})

	assert.NoError(t, err)
	assert.True(t, resp.HasMore)
	assert.Len(t, resp.Messages, 1)
	assert.Equal(t, "msg-1", resp.Messages[0].Id)
	assert.Equal(t, "human", resp.Messages[0].Analysis.Verdict)
}

func TestGetChatHistory_NotFound(t *testing.T) {
	svc := new(mocks.MockChatService)
	h := NewHandler(svc)
	ctx := ctxWithUserID("user-1")

	svc.On("GetHistory", ctx, "missing", "user-1", int32(0), int32(0)).Return(nil, false, domain.ErrNotFound)

	_, err := h.GetChatHistory(ctx, &pb.GetChatHistoryRequest{ChatId: "missing"})

	assert.Error(t, err)
	st, _ := status.FromError(err)
	assert.Equal(t, codes.NotFound, st.Code())
}

// --- extractUserID ---

func TestExtractUserID_MissingMetadata(t *testing.T) {
	svc := new(mocks.MockChatService)
	h := NewHandler(svc)

	svc.On("GetSession", mock.Anything, "chat-1", "").Return(nil, domain.ErrUnauthorized)

	_, err := h.GetChat(context.Background(), &pb.GetChatRequest{ChatId: "chat-1"})

	assert.Error(t, err)
	st, _ := status.FromError(err)
	assert.Equal(t, codes.PermissionDenied, st.Code())
}

func TestExtractUserID_EmptyHeader(t *testing.T) {
	svc := new(mocks.MockChatService)
	h := NewHandler(svc)
	md := metadata.New(map[string]string{})
	ctx := metadata.NewIncomingContext(context.Background(), md)

	svc.On("GetSession", mock.Anything, "chat-1", "").Return(nil, domain.ErrUnauthorized)

	_, err := h.GetChat(ctx, &pb.GetChatRequest{ChatId: "chat-1"})

	assert.Error(t, err)
	st, _ := status.FromError(err)
	assert.Equal(t, codes.PermissionDenied, st.Code())
}

// --- mapError (table-driven) ---

func TestMapError_AllCodes(t *testing.T) {
	h := &Handler{}

	cases := []struct {
		name     string
		input    error
		wantCode codes.Code
	}{
		{"not found", domain.ErrNotFound, codes.NotFound},
		{"unauthorized", domain.ErrUnauthorized, codes.PermissionDenied},
		{"invalid input", domain.ErrInvalidInput, codes.InvalidArgument},
		{"generic error", errors.New("unknown failure"), codes.Internal},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := h.mapError(tc.input)
			st, ok := status.FromError(err)
			assert.True(t, ok)
			assert.Equal(t, tc.wantCode, st.Code())
		})
	}
}