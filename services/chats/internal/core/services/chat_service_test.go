package services

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/core/domain"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/mocks"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"go.uber.org/zap"
)

func TestCreateSession(t *testing.T) {
	dbRepo := new(mocks.MockChatPersistenceRepository)
	cacheRepo := new(mocks.MockChatCacheRepository)
	streamRepo := new(mocks.MockChatStreamRepository)
	metrics := new(mocks.MockMetricsCollector)
	logger := zap.NewNop()

	service := NewChatService(cacheRepo, streamRepo, dbRepo, logger, metrics)
	ctx := context.Background()

	userID := "user-123"
	title := "New Chat"

	dbRepo.On("CreateChat", mock.Anything, mock.MatchedBy(func(chat *domain.ChatSession) bool {
		return chat.UserID == userID && chat.Title == title && chat.ID != ""
	})).Return(nil)

	session, err := service.CreateSession(ctx, userID, title)

	assert.NoError(t, err)
	assert.Equal(t, userID, session.UserID)
	assert.Equal(t, title, session.Title)
	dbRepo.AssertExpectations(t)
}

func TestProcessMessage(t *testing.T) {
	dbRepo := new(mocks.MockChatPersistenceRepository)
	cacheRepo := new(mocks.MockChatCacheRepository)
	streamRepo := new(mocks.MockChatStreamRepository)
	metrics := new(mocks.MockMetricsCollector)
	logger := zap.NewNop()

	service := NewChatService(cacheRepo, streamRepo, dbRepo, logger, metrics)
	ctx := context.Background()

	msg := &domain.Message{
		ChatID:  "chat-1",
		UserID:  "user-123",
		Content: "Hello",
	}

	mockChat := &domain.ChatSession{ID: "chat-1", UserID: "user-123"}

	dbRepo.On("GetChat", mock.Anything, "chat-1").Return(mockChat, nil)
	streamRepo.On("Publish", mock.Anything, mock.MatchedBy(func(m *domain.Message) bool {
		return m.Content == "Hello" && m.ChatID == "chat-1" && m.UserID == "user-123"
	})).Return(nil)
	cacheRepo.On("SaveToCache", mock.Anything, mock.MatchedBy(func(m *domain.Message) bool {
		return m.Content == "Hello" && m.ChatID == "chat-1" && m.UserID == "user-123"
	})).Return(nil)

	err := service.ProcessMessage(ctx, msg)

	assert.NoError(t, err)
	dbRepo.AssertExpectations(t)
	streamRepo.AssertExpectations(t)
	cacheRepo.AssertExpectations(t)
}

func TestProcessMessage_Unauthorized(t *testing.T) {
	dbRepo := new(mocks.MockChatPersistenceRepository)
	cacheRepo := new(mocks.MockChatCacheRepository)
	streamRepo := new(mocks.MockChatStreamRepository)
	metrics := new(mocks.MockMetricsCollector)
	logger := zap.NewNop()

	service := NewChatService(cacheRepo, streamRepo, dbRepo, logger, metrics)
	ctx := context.Background()

	msg := &domain.Message{
		ChatID:  "chat-1",
		UserID:  "wrong-user",
		Content: "Hello",
	}

	mockChat := &domain.ChatSession{ID: "chat-1", UserID: "owner-user"}

	dbRepo.On("GetChat", mock.Anything, "chat-1").Return(mockChat, nil)

	err := service.ProcessMessage(ctx, msg)

	assert.ErrorIs(t, err, domain.ErrUnauthorized)
}

func TestGetHistory_CacheHit(t *testing.T) {
	dbRepo := new(mocks.MockChatPersistenceRepository)
	cacheRepo := new(mocks.MockChatCacheRepository)
	streamRepo := new(mocks.MockChatStreamRepository)
	metrics := new(mocks.MockMetricsCollector)
	logger := zap.NewNop()

	service := NewChatService(cacheRepo, streamRepo, dbRepo, logger, metrics)
	ctx := context.Background()

	chatID := "chat-1"
	userID := "user-123"
	pageSize := int32(2)

	mockChat := &domain.ChatSession{ID: chatID, UserID: userID}
	cachedMsgs := []*domain.Message{
		{ID: "msg-cache-new", CreatedAt: time.Now().UTC()},
		{ID: "msg-cache-old", CreatedAt: time.Now().UTC().Add(-time.Minute)},
	}

	dbRepo.On("GetChat", mock.Anything, chatID).Return(mockChat, nil)
	cacheRepo.On("GetRecentMessages", mock.Anything, chatID).Return(cachedMsgs, nil)
	metrics.On("IncCacheHit").Return()

	dbRepo.On("GetHistory", mock.Anything, chatID, 0, 2).Return([]*domain.Message{
		{ID: "msg-cache-old", CreatedAt: cachedMsgs[1].CreatedAt},
		{ID: "msg-db", CreatedAt: cachedMsgs[1].CreatedAt.Add(-time.Minute)},
	}, nil)

	result, hasMore, err := service.GetHistory(ctx, chatID, userID, 1, pageSize)

	assert.NoError(t, err)
	assert.Len(t, result, 2)
	assert.True(t, hasMore)
	assert.Equal(t, "msg-cache-new", result[0].ID)
	assert.Equal(t, "msg-cache-old", result[1].ID)
}

func TestGetHistory_CacheMiss_ReadRepair(t *testing.T) {
	dbRepo := new(mocks.MockChatPersistenceRepository)
	cacheRepo := new(mocks.MockChatCacheRepository)
	streamRepo := new(mocks.MockChatStreamRepository)
	metrics := new(mocks.MockMetricsCollector)
	logger := zap.NewNop()

	service := NewChatService(cacheRepo, streamRepo, dbRepo, logger, metrics)
	ctx := context.Background()

	chatID := "chat-1"
	userID := "user-123"
	pageSize := int32(20)

	mockChat := &domain.ChatSession{ID: chatID, UserID: userID}
	dbMsgs := []*domain.Message{
		{ID: "msg-1"}, {ID: "msg-2"},
	}

	dbRepo.On("GetChat", mock.Anything, chatID).Return(mockChat, nil)
	cacheRepo.On("GetRecentMessages", mock.Anything, chatID).Return(nil, errors.New("cache miss"))
	metrics.On("IncCacheMiss").Return()
	dbRepo.On("GetHistory", mock.Anything, chatID, 0, 20).Return(dbMsgs, nil)
	cacheRepo.On("PopulateCache", mock.Anything, chatID, dbMsgs).Return(nil)

	result, hasMore, err := service.GetHistory(ctx, chatID, userID, 1, pageSize)

	assert.NoError(t, err)
	assert.Len(t, result, 2)
	assert.False(t, hasMore)
	
	// Wait a bit for background goroutine
	time.Sleep(100 * time.Millisecond)
	cacheRepo.AssertExpectations(t)
}

func TestDeleteSession(t *testing.T) {
	dbRepo := new(mocks.MockChatPersistenceRepository)
	cacheRepo := new(mocks.MockChatCacheRepository)
	streamRepo := new(mocks.MockChatStreamRepository)
	metrics := new(mocks.MockMetricsCollector)
	logger := zap.NewNop()

	service := NewChatService(cacheRepo, streamRepo, dbRepo, logger, metrics)
	ctx := context.Background()

	chatID := "chat-1"
	userID := "user-123"

	mockChat := &domain.ChatSession{ID: chatID, UserID: userID}

	dbRepo.On("GetChat", mock.Anything, chatID).Return(mockChat, nil)
	dbRepo.On("DeleteChat", mock.Anything, chatID).Return(nil)
	cacheRepo.On("DeleteCache", mock.Anything, chatID).Return(nil)

	err := service.DeleteSession(ctx, chatID, userID)

	assert.NoError(t, err)
	dbRepo.AssertExpectations(t)
	cacheRepo.AssertExpectations(t)
}
