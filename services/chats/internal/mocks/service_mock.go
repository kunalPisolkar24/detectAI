package mocks

import (
	"context"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/core/domain"
	"github.com/stretchr/testify/mock"
)

type MockChatService struct {
	mock.Mock
}

func (m *MockChatService) CreateSession(ctx context.Context, userID, title string) (*domain.ChatSession, error) {
	args := m.Called(ctx, userID, title)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*domain.ChatSession), args.Error(1)
}

func (m *MockChatService) GetSession(ctx context.Context, chatID, userID string) (*domain.ChatSession, error) {
	args := m.Called(ctx, chatID, userID)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*domain.ChatSession), args.Error(1)
}

func (m *MockChatService) GetUserSessions(ctx context.Context, userID string) ([]*domain.ChatSession, error) {
	args := m.Called(ctx, userID)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).([]*domain.ChatSession), args.Error(1)
}

func (m *MockChatService) RenameSession(ctx context.Context, chatID, userID, newTitle string) error {
	args := m.Called(ctx, chatID, userID, newTitle)
	return args.Error(0)
}

func (m *MockChatService) DeleteSession(ctx context.Context, chatID, userID string) error {
	args := m.Called(ctx, chatID, userID)
	return args.Error(0)
}

func (m *MockChatService) ProcessMessage(ctx context.Context, msg *domain.Message) error {
	args := m.Called(ctx, msg)
	return args.Error(0)
}

func (m *MockChatService) GetHistory(ctx context.Context, chatID, userID string, page, pageSize int32) ([]*domain.Message, bool, error) {
	args := m.Called(ctx, chatID, userID, page, pageSize)
	if args.Get(0) == nil {
		return nil, false, args.Error(2)
	}
	return args.Get(0).([]*domain.Message), args.Bool(1), args.Error(2)
}