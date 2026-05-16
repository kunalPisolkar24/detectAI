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

func setupTest(t *testing.T) (*ChatService, *mocks.MockChatCacheRepository, *mocks.MockChatStreamRepository, *mocks.MockChatPersistenceRepository, *mocks.MockMetricsCollector) {
	cacheRepo := new(mocks.MockChatCacheRepository)
	streamRepo := new(mocks.MockChatStreamRepository)
	dbRepo := new(mocks.MockChatPersistenceRepository)
	metrics := new(mocks.MockMetricsCollector)
	service := NewChatService(cacheRepo, streamRepo, dbRepo, zap.NewNop(), metrics)
	return service, cacheRepo, streamRepo, dbRepo, metrics
}

func TestCreateSession(t *testing.T) {
	service, _, _, dbRepo, _ := setupTest(t)

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
	service, cacheRepo, streamRepo, dbRepo, _ := setupTest(t)

	ctx := context.Background()
	msg := &domain.Message{
		ChatID:  "chat-1",
		UserID:  "user-1",
		Content: "Hello World",
	}

	mockChat := &domain.ChatSession{
		ID:     "chat-1",
		UserID: "user-1",
		Title:  "Existing Chat",
	}

	dbRepo.On("GetChat", ctx, "chat-1").Return(mockChat, nil)
	
	streamRepo.On("Publish", ctx, mock.MatchedBy(func(m *domain.Message) bool {
		return m.ID != "" && !m.CreatedAt.IsZero() && m.Content == "Hello World"
	})).Return(nil)

	cacheRepo.On("SaveToCache", ctx, mock.MatchedBy(func(m *domain.Message) bool {
		return m.ID != ""
	})).Return(nil)

	err := service.ProcessMessage(ctx, msg)

	assert.NoError(t, err)
	assert.NotEmpty(t, msg.ID)
	dbRepo.AssertExpectations(t)
	streamRepo.AssertExpectations(t)
	cacheRepo.AssertExpectations(t)
}

func TestProcessMessage_Unauthorized(t *testing.T) {
	service, cacheRepo, streamRepo, dbRepo, _ := setupTest(t)

	ctx := context.Background()
	msg := &domain.Message{
		ChatID:  "chat-1",
		UserID:  "intruder-id",
		Content: "Hello",
	}

	mockChat := &domain.ChatSession{
		ID:     "chat-1",
		UserID: "owner-id",
		Title:  "Existing Chat",
	}

	dbRepo.On("GetChat", ctx, "chat-1").Return(mockChat, nil)

	err := service.ProcessMessage(ctx, msg)

	assert.ErrorIs(t, err, domain.ErrUnauthorized)
	streamRepo.AssertNotCalled(t, "Publish")
	cacheRepo.AssertNotCalled(t, "SaveToCache")
}

func TestGetHistory_MergesCacheAndPersistence(t *testing.T) {
	service, cacheRepo, _, dbRepo, metrics := setupTest(t)

	ctx := context.Background()
	chatID := "chat-1"
	userID := "user-1"
	pageSize := int32(2)

	mockChat := &domain.ChatSession{ID: chatID, UserID: userID}
	dbRepo.On("GetChat", ctx, chatID).Return(mockChat, nil)

	cachedMsgs := []*domain.Message{
		{ID: "msg-cache-new", CreatedAt: time.Now().UTC()},
		{ID: "msg-cache-old", CreatedAt: time.Now().UTC().Add(-time.Minute)},
	}

	cacheRepo.On("GetRecentMessages", ctx, chatID).Return(cachedMsgs, nil)
	metrics.On("IncCacheHit").Return()

	dbRepo.On("GetHistory", ctx, chatID, 0, 2).Return([]*domain.Message{
		{ID: "msg-cache-old", CreatedAt: cachedMsgs[1].CreatedAt},
		{ID: "msg-db", CreatedAt: cachedMsgs[1].CreatedAt.Add(-time.Minute)},
	}, nil)

	result, hasMore, err := service.GetHistory(ctx, chatID, userID, 1, pageSize)

	assert.NoError(t, err)
	assert.True(t, hasMore)
	assert.Len(t, result, 2)
	assert.Equal(t, "msg-cache-new", result[0].ID)
	assert.Equal(t, "msg-cache-old", result[1].ID)
	cacheRepo.AssertNotCalled(t, "PopulateCache")
}

func TestGetHistory_CacheMiss_ReadRepair(t *testing.T) {
	service, cacheRepo, _, dbRepo, metrics := setupTest(t)

	ctx := context.Background()
	chatID := "chat-1"
	userID := "user-1"
	pageSize := int32(20)

	mockChat := &domain.ChatSession{ID: chatID, UserID: userID}
	dbRepo.On("GetChat", ctx, chatID).Return(mockChat, nil)

	cacheRepo.On("GetRecentMessages", ctx, chatID).Return(nil, errors.New("cache miss"))
	metrics.On("IncCacheMiss").Return()
	
	dbMsgs := []*domain.Message{{ID: "msg-old"}, {ID: "msg-older"}}
	dbRepo.On("GetHistory", ctx, chatID, 0, 20).Return(dbMsgs, nil)

	cacheRepo.On("PopulateCache", mock.Anything, chatID, dbMsgs).Return(nil)

	result, hasMore, err := service.GetHistory(ctx, chatID, userID, 1, pageSize)

	assert.NoError(t, err)
	assert.False(t, hasMore) 
	assert.Len(t, result, 2)
	assert.Equal(t, "msg-old", result[0].ID)

	time.Sleep(50 * time.Millisecond)
	cacheRepo.AssertExpectations(t)
	metrics.AssertExpectations(t)
}

func TestDeleteSession(t *testing.T) {
	service, cacheRepo, _, dbRepo, _ := setupTest(t)

	ctx := context.Background()
	chatID := "chat-1"
	userID := "user-1"

	mockChat := &domain.ChatSession{ID: chatID, UserID: userID}
	dbRepo.On("GetChat", ctx, chatID).Return(mockChat, nil)

	dbRepo.On("DeleteChat", ctx, chatID).Return(nil)
	cacheRepo.On("DeleteCache", ctx, chatID).Return(nil)

	err := service.DeleteSession(ctx, chatID, userID)

	assert.NoError(t, err)
	dbRepo.AssertExpectations(t)
	cacheRepo.AssertExpectations(t)
}
