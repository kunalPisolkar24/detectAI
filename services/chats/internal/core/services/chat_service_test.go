package services

import (
	"context"
	"errors"
	"testing"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/core/domain"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/mocks"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
)

func TestCreateSession(t *testing.T) {
	cacheRepo := new(mocks.MockChatCacheRepository)
	streamRepo := new(mocks.MockChatStreamRepository)
	dbRepo := new(mocks.MockChatPersistenceRepository)
	service := NewChatService(cacheRepo, streamRepo, dbRepo)

	ctx := context.Background()
	userID := "user-123"
	title := "New Chat"

	dbRepo.On("CreateChat", ctx, mock.MatchedBy(func(chat *domain.ChatSession) bool {
		return chat.UserID == userID && chat.Title == title && chat.ID != ""
	})).Return(nil)

	session, err := service.CreateSession(ctx, userID, title)

	assert.NoError(t, err)
	assert.NotNil(t, session)
	assert.Equal(t, userID, session.UserID)
	assert.Equal(t, title, session.Title)
	assert.NotEmpty(t, session.ID)
	dbRepo.AssertExpectations(t)
}

func TestProcessMessage_Success(t *testing.T) {
	cacheRepo := new(mocks.MockChatCacheRepository)
	streamRepo := new(mocks.MockChatStreamRepository)
	dbRepo := new(mocks.MockChatPersistenceRepository)
	service := NewChatService(cacheRepo, streamRepo, dbRepo)

	ctx := context.Background()
	msg := &domain.Message{
		ChatID:  "chat-1",
		UserID:  "user-1",
		Content: "Hello",
	}

	mockChat := &domain.ChatSession{
		ID:     "chat-1",
		UserID: "user-1",
	}

	dbRepo.On("GetChat", ctx, "chat-1").Return(mockChat, nil)
	streamRepo.On("Publish", ctx, mock.MatchedBy(func(m *domain.Message) bool {
		return m.ID != "" && !m.CreatedAt.IsZero()
	})).Return(nil)
	cacheRepo.On("SaveToCache", ctx, mock.AnythingOfType("*domain.Message")).Return(nil)

	err := service.ProcessMessage(ctx, msg)

	assert.NoError(t, err)
	assert.NotEmpty(t, msg.ID)
	dbRepo.AssertExpectations(t)
	streamRepo.AssertExpectations(t)
	cacheRepo.AssertExpectations(t)
}

func TestProcessMessage_Unauthorized(t *testing.T) {
	cacheRepo := new(mocks.MockChatCacheRepository)
	streamRepo := new(mocks.MockChatStreamRepository)
	dbRepo := new(mocks.MockChatPersistenceRepository)
	service := NewChatService(cacheRepo, streamRepo, dbRepo)

	ctx := context.Background()
	msg := &domain.Message{
		ChatID: "chat-1",
		UserID: "intruder",
	}

	mockChat := &domain.ChatSession{
		ID:     "chat-1",
		UserID: "owner",
	}

	dbRepo.On("GetChat", ctx, "chat-1").Return(mockChat, nil)

	err := service.ProcessMessage(ctx, msg)

	assert.Error(t, err)
	assert.Contains(t, err.Error(), "unauthorized")
	streamRepo.AssertNotCalled(t, "Publish")
}

func TestGetHistory_CacheHit(t *testing.T) {
	cacheRepo := new(mocks.MockChatCacheRepository)
	streamRepo := new(mocks.MockChatStreamRepository)
	dbRepo := new(mocks.MockChatPersistenceRepository)
	service := NewChatService(cacheRepo, streamRepo, dbRepo)

	ctx := context.Background()
	chatID := "chat-1"
	cachedMsgs := []*domain.Message{
		{ID: "msg-1"}, {ID: "msg-2"},
	}

	cacheRepo.On("GetRecentMessages", ctx, chatID).Return(cachedMsgs, nil)

	result, hasMore, err := service.GetHistory(ctx, chatID, 1, 2)

	assert.NoError(t, err)
	assert.True(t, hasMore)
	assert.Len(t, result, 2)
	assert.Equal(t, "msg-1", result[0].ID)
	dbRepo.AssertNotCalled(t, "GetHistory")
}

func TestGetHistory_CacheMiss_DBFallback(t *testing.T) {
	cacheRepo := new(mocks.MockChatCacheRepository)
	streamRepo := new(mocks.MockChatStreamRepository)
	dbRepo := new(mocks.MockChatPersistenceRepository)
	service := NewChatService(cacheRepo, streamRepo, dbRepo)

	ctx := context.Background()
	chatID := "chat-1"

	cacheRepo.On("GetRecentMessages", ctx, chatID).Return(nil, errors.New("cache miss"))
	
	dbMsgs := []*domain.Message{{ID: "msg-old"}}
	dbRepo.On("GetHistory", ctx, chatID, 0, 20).Return(dbMsgs, nil)

	result, hasMore, err := service.GetHistory(ctx, chatID, 1, 20)

	assert.NoError(t, err)
	assert.False(t, hasMore) 
	assert.Len(t, result, 1)
	assert.Equal(t, "msg-old", result[0].ID)
}

func TestGetHistory_SecondPage_SkipCache(t *testing.T) {
	cacheRepo := new(mocks.MockChatCacheRepository)
	streamRepo := new(mocks.MockChatStreamRepository)
	dbRepo := new(mocks.MockChatPersistenceRepository)
	service := NewChatService(cacheRepo, streamRepo, dbRepo)

	ctx := context.Background()
	chatID := "chat-1"
	
	dbMsgs := []*domain.Message{{ID: "msg-older"}}
	dbRepo.On("GetHistory", ctx, chatID, 20, 20).Return(dbMsgs, nil)

	result, hasMore, err := service.GetHistory(ctx, chatID, 2, 20)

	assert.NoError(t, err)
	assert.False(t, hasMore)
	assert.Len(t, result, 1)
	cacheRepo.AssertNotCalled(t, "GetRecentMessages")
}