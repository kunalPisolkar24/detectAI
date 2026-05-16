package usecase

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

func newTestService() (*mocks.MockChatPersistenceRepository, *mocks.MockChatCacheRepository, *mocks.MockChatStreamRepository, *mocks.MockMetricsCollector, *ChatService) {
	dbRepo := new(mocks.MockChatPersistenceRepository)
	cacheRepo := new(mocks.MockChatCacheRepository)
	streamRepo := new(mocks.MockChatStreamRepository)
	metricsCollector := new(mocks.MockMetricsCollector)
	svc := NewChatService(cacheRepo, streamRepo, dbRepo, zap.NewNop(), metricsCollector)
	return dbRepo, cacheRepo, streamRepo, metricsCollector, svc
}

// --- CreateSession ---

func TestCreateSession_Success(t *testing.T) {
	dbRepo, _, _, _, svc := newTestService()
	ctx := context.Background()

	dbRepo.On("CreateChat", mock.Anything, mock.MatchedBy(func(c *domain.ChatSession) bool {
		return c.UserID == "user-1" && c.Title == "My Chat" && c.ID != ""
	})).Return(nil)

	session, err := svc.CreateSession(ctx, "user-1", "My Chat")

	assert.NoError(t, err)
	assert.Equal(t, "user-1", session.UserID)
	assert.Equal(t, "My Chat", session.Title)
	assert.NotEmpty(t, session.ID)
	dbRepo.AssertExpectations(t)
}

func TestCreateSession_InvalidInput(t *testing.T) {
	_, _, _, _, svc := newTestService()
	ctx := context.Background()

	_, err := svc.CreateSession(ctx, "", "My Chat")
	assert.ErrorIs(t, err, domain.ErrInvalidInput)

	_, err = svc.CreateSession(ctx, "user-1", "")
	assert.ErrorIs(t, err, domain.ErrInvalidInput)
}

func TestCreateSession_DBError(t *testing.T) {
	dbRepo, _, _, _, svc := newTestService()
	ctx := context.Background()

	dbRepo.On("CreateChat", mock.Anything, mock.Anything).Return(errors.New("db connection refused"))

	_, err := svc.CreateSession(ctx, "user-1", "My Chat")

	assert.Error(t, err)
	assert.NotErrorIs(t, err, domain.ErrInvalidInput)
}

// --- GetSession ---

func TestGetSession_Success(t *testing.T) {
	dbRepo, _, _, _, svc := newTestService()
	ctx := context.Background()

	mockChat := &domain.ChatSession{ID: "chat-1", UserID: "user-1"}
	dbRepo.On("GetChat", mock.Anything, "chat-1").Return(mockChat, nil)

	session, err := svc.GetSession(ctx, "chat-1", "user-1")

	assert.NoError(t, err)
	assert.Equal(t, "chat-1", session.ID)
}

func TestGetSession_Unauthorized(t *testing.T) {
	dbRepo, _, _, _, svc := newTestService()
	ctx := context.Background()

	mockChat := &domain.ChatSession{ID: "chat-1", UserID: "owner"}
	dbRepo.On("GetChat", mock.Anything, "chat-1").Return(mockChat, nil)

	_, err := svc.GetSession(ctx, "chat-1", "attacker")

	assert.ErrorIs(t, err, domain.ErrUnauthorized)
}

func TestGetSession_DBError(t *testing.T) {
	dbRepo, _, _, _, svc := newTestService()
	ctx := context.Background()

	dbRepo.On("GetChat", mock.Anything, "chat-1").Return(nil, errors.New("not found"))

	_, err := svc.GetSession(ctx, "chat-1", "user-1")

	assert.ErrorIs(t, err, domain.ErrNotFound)
}

// --- GetUserSessions ---

func TestGetUserSessions_Success(t *testing.T) {
	dbRepo, _, _, _, svc := newTestService()
	ctx := context.Background()

	chats := []*domain.ChatSession{{ID: "chat-1"}, {ID: "chat-2"}}
	dbRepo.On("GetUserChats", mock.Anything, "user-1", 50).Return(chats, nil)

	result, err := svc.GetUserSessions(ctx, "user-1")

	assert.NoError(t, err)
	assert.Len(t, result, 2)
	dbRepo.AssertExpectations(t)
}

func TestGetUserSessions_InvalidInput(t *testing.T) {
	_, _, _, _, svc := newTestService()
	ctx := context.Background()

	_, err := svc.GetUserSessions(ctx, "")

	assert.ErrorIs(t, err, domain.ErrInvalidInput)
}

// --- RenameSession ---

func TestRenameSession_Success(t *testing.T) {
	dbRepo, _, _, _, svc := newTestService()
	ctx := context.Background()

	mockChat := &domain.ChatSession{ID: "chat-1", UserID: "user-1"}
	dbRepo.On("GetChat", mock.Anything, "chat-1").Return(mockChat, nil)
	dbRepo.On("UpdateChatTitle", mock.Anything, "chat-1", "New Title").Return(nil)

	err := svc.RenameSession(ctx, "chat-1", "user-1", "New Title")

	assert.NoError(t, err)
	dbRepo.AssertExpectations(t)
}

func TestRenameSession_Unauthorized(t *testing.T) {
	dbRepo, _, _, _, svc := newTestService()
	ctx := context.Background()

	mockChat := &domain.ChatSession{ID: "chat-1", UserID: "owner"}
	dbRepo.On("GetChat", mock.Anything, "chat-1").Return(mockChat, nil)

	err := svc.RenameSession(ctx, "chat-1", "attacker", "New Title")

	assert.ErrorIs(t, err, domain.ErrUnauthorized)
}

func TestRenameSession_InvalidInput(t *testing.T) {
	_, _, _, _, svc := newTestService()
	ctx := context.Background()

	err := svc.RenameSession(ctx, "chat-1", "user-1", "")

	assert.ErrorIs(t, err, domain.ErrInvalidInput)
}

// --- DeleteSession ---

func TestDeleteSession_Success(t *testing.T) {
	dbRepo, cacheRepo, _, _, svc := newTestService()
	ctx := context.Background()

	mockChat := &domain.ChatSession{ID: "chat-1", UserID: "user-1"}
	dbRepo.On("GetChat", mock.Anything, "chat-1").Return(mockChat, nil)
	dbRepo.On("DeleteChat", mock.Anything, "chat-1").Return(nil)
	cacheRepo.On("DeleteCache", mock.Anything, "chat-1").Return(nil)

	err := svc.DeleteSession(ctx, "chat-1", "user-1")

	assert.NoError(t, err)
	dbRepo.AssertExpectations(t)
	cacheRepo.AssertExpectations(t)
}

func TestDeleteSession_CacheError_IsGraceful(t *testing.T) {
	dbRepo, cacheRepo, _, _, svc := newTestService()
	ctx := context.Background()

	mockChat := &domain.ChatSession{ID: "chat-1", UserID: "user-1"}
	dbRepo.On("GetChat", mock.Anything, "chat-1").Return(mockChat, nil)
	dbRepo.On("DeleteChat", mock.Anything, "chat-1").Return(nil)
	cacheRepo.On("DeleteCache", mock.Anything, "chat-1").Return(errors.New("redis timeout"))

	err := svc.DeleteSession(ctx, "chat-1", "user-1")

	assert.NoError(t, err, "cache error should be tolerated, not returned to caller")
}

// --- ProcessMessage ---

func TestProcessMessage_Success(t *testing.T) {
	dbRepo, cacheRepo, streamRepo, _, svc := newTestService()
	ctx := context.Background()

	mockChat := &domain.ChatSession{ID: "chat-1", UserID: "user-1"}
	dbRepo.On("GetChat", mock.Anything, "chat-1").Return(mockChat, nil)
	streamRepo.On("Publish", mock.Anything, mock.Anything).Return(nil)
	cacheRepo.On("SaveToCache", mock.Anything, mock.Anything).Return(nil)

	err := svc.ProcessMessage(ctx, &domain.Message{ChatID: "chat-1", UserID: "user-1", Content: "hello"})

	assert.NoError(t, err)
}

func TestProcessMessage_InvalidInput(t *testing.T) {
	_, _, _, _, svc := newTestService()
	ctx := context.Background()

	assert.ErrorIs(t, svc.ProcessMessage(ctx, &domain.Message{ChatID: "", UserID: "u", Content: "c"}), domain.ErrInvalidInput)
	assert.ErrorIs(t, svc.ProcessMessage(ctx, &domain.Message{ChatID: "c", UserID: "", Content: "c"}), domain.ErrInvalidInput)
	assert.ErrorIs(t, svc.ProcessMessage(ctx, &domain.Message{ChatID: "c", UserID: "u", Content: ""}), domain.ErrInvalidInput)
}

func TestProcessMessage_Unauthorized(t *testing.T) {
	dbRepo, _, _, _, svc := newTestService()
	ctx := context.Background()

	mockChat := &domain.ChatSession{ID: "chat-1", UserID: "owner"}
	dbRepo.On("GetChat", mock.Anything, "chat-1").Return(mockChat, nil)

	err := svc.ProcessMessage(ctx, &domain.Message{ChatID: "chat-1", UserID: "attacker", Content: "hi"})

	assert.ErrorIs(t, err, domain.ErrUnauthorized)
}

// --- GetHistory ---

func TestGetHistory_CacheHit(t *testing.T) {
	dbRepo, cacheRepo, _, metricsCollector, svc := newTestService()
	ctx := context.Background()

	mockChat := &domain.ChatSession{ID: "chat-1", UserID: "user-1"}
	cachedMsgs := []*domain.Message{
		{ID: "msg-new", CreatedAt: time.Now().UTC()},
		{ID: "msg-old", CreatedAt: time.Now().UTC().Add(-time.Minute)},
	}

	dbRepo.On("GetChat", mock.Anything, "chat-1").Return(mockChat, nil)
	cacheRepo.On("GetRecentMessages", mock.Anything, "chat-1").Return(cachedMsgs, nil)
	metricsCollector.On("IncCacheHit").Return()
	dbRepo.On("GetHistory", mock.Anything, "chat-1", 0, 2).Return([]*domain.Message{
		{ID: "msg-old", CreatedAt: cachedMsgs[1].CreatedAt},
		{ID: "msg-db", CreatedAt: cachedMsgs[1].CreatedAt.Add(-time.Minute)},
	}, nil)

	result, hasMore, err := svc.GetHistory(ctx, "chat-1", "user-1", 1, 2)

	assert.NoError(t, err)
	assert.True(t, hasMore)
	assert.Len(t, result, 2)
	assert.Equal(t, "msg-new", result[0].ID)
}

func TestGetHistory_CacheMiss_ReadRepair(t *testing.T) {
	dbRepo, cacheRepo, _, metricsCollector, svc := newTestService()
	ctx := context.Background()

	mockChat := &domain.ChatSession{ID: "chat-1", UserID: "user-1"}
	dbMsgs := []*domain.Message{{ID: "msg-1"}, {ID: "msg-2"}}

	dbRepo.On("GetChat", mock.Anything, "chat-1").Return(mockChat, nil)
	cacheRepo.On("GetRecentMessages", mock.Anything, "chat-1").Return(nil, errors.New("cache miss"))
	metricsCollector.On("IncCacheMiss").Return()
	dbRepo.On("GetHistory", mock.Anything, "chat-1", 0, 20).Return(dbMsgs, nil)
	cacheRepo.On("PopulateCache", mock.Anything, "chat-1", dbMsgs).Return(nil)

	result, hasMore, err := svc.GetHistory(ctx, "chat-1", "user-1", 1, 20)

	assert.NoError(t, err)
	assert.False(t, hasMore)
	assert.Len(t, result, 2)

	time.Sleep(100 * time.Millisecond)
	cacheRepo.AssertExpectations(t)
}

func TestGetHistory_ColdPath_PageGreaterThanOne(t *testing.T) {
	dbRepo, _, _, _, svc := newTestService()
	ctx := context.Background()

	mockChat := &domain.ChatSession{ID: "chat-1", UserID: "user-1"}
	dbMsgs := []*domain.Message{{ID: "msg-1"}}

	dbRepo.On("GetChat", mock.Anything, "chat-1").Return(mockChat, nil)
	dbRepo.On("GetHistory", mock.Anything, "chat-1", 20, 20).Return(dbMsgs, nil)

	result, hasMore, err := svc.GetHistory(ctx, "chat-1", "user-1", 2, 20)

	assert.NoError(t, err)
	assert.False(t, hasMore)
	assert.Len(t, result, 1)
	dbRepo.AssertExpectations(t)
}

func TestGetHistory_Unauthorized(t *testing.T) {
	dbRepo, _, _, _, svc := newTestService()
	ctx := context.Background()

	mockChat := &domain.ChatSession{ID: "chat-1", UserID: "owner"}
	dbRepo.On("GetChat", mock.Anything, "chat-1").Return(mockChat, nil)

	_, _, err := svc.GetHistory(ctx, "chat-1", "attacker", 1, 10)

	assert.ErrorIs(t, err, domain.ErrUnauthorized)
}
