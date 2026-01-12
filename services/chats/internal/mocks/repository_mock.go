package mocks

import (
	"context"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/core/domain"
	"github.com/stretchr/testify/mock"
)

type MockChatCacheRepository struct {
	mock.Mock
}

func (m *MockChatCacheRepository) SaveToCache(ctx context.Context, msg *domain.Message) error {
	args := m.Called(ctx, msg)
	return args.Error(0)
}

func (m *MockChatCacheRepository) PopulateCache(ctx context.Context, chatID string, messages []*domain.Message) error {
	args := m.Called(ctx, chatID, messages)
	return args.Error(0)
}

func (m *MockChatCacheRepository) GetRecentMessages(ctx context.Context, chatID string) ([]*domain.Message, error) {
	args := m.Called(ctx, chatID)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).([]*domain.Message), args.Error(1)
}

func (m *MockChatCacheRepository) DeleteCache(ctx context.Context, chatID string) error {
	args := m.Called(ctx, chatID)
	return args.Error(0)
}

type MockChatStreamRepository struct {
	mock.Mock
}

func (m *MockChatStreamRepository) Publish(ctx context.Context, msg *domain.Message) error {
	args := m.Called(ctx, msg)
	return args.Error(0)
}

type MockChatPersistenceRepository struct {
	mock.Mock
}

func (m *MockChatPersistenceRepository) CreateChat(ctx context.Context, chat *domain.ChatSession) error {
	args := m.Called(ctx, chat)
	return args.Error(0)
}

func (m *MockChatPersistenceRepository) GetChat(ctx context.Context, chatID string) (*domain.ChatSession, error) {
	args := m.Called(ctx, chatID)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*domain.ChatSession), args.Error(1)
}

func (m *MockChatPersistenceRepository) GetUserChats(ctx context.Context, userID string, limit int) ([]*domain.ChatSession, error) {
	args := m.Called(ctx, userID, limit)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).([]*domain.ChatSession), args.Error(1)
}

func (m *MockChatPersistenceRepository) UpdateChatTitle(ctx context.Context, chatID, title string) error {
	args := m.Called(ctx, chatID, title)
	return args.Error(0)
}

func (m *MockChatPersistenceRepository) DeleteChat(ctx context.Context, chatID string) error {
	args := m.Called(ctx, chatID)
	return args.Error(0)
}

func (m *MockChatPersistenceRepository) BulkUpsertMessages(ctx context.Context, messages []*domain.Message) error {
	args := m.Called(ctx, messages)
	return args.Error(0)
}

func (m *MockChatPersistenceRepository) GetHistory(ctx context.Context, chatID string, offset, limit int) ([]*domain.Message, error) {
	args := m.Called(ctx, chatID, offset, limit)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).([]*domain.Message), args.Error(1)
}