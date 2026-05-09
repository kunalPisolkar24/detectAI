package mocks

import (
	"context"
	"github.com/stretchr/testify/mock"
)

type MockPaymentService struct {
	mock.Mock
}

func (m *MockPaymentService) ProcessWebhook(ctx context.Context, signature string, body []byte) error {
	args := m.Called(ctx, signature, body)
	return args.Error(0)
}

func (m *MockPaymentService) ProcessInternalEvent(ctx context.Context, body []byte) error {
	args := m.Called(ctx, body)
	return args.Error(0)
}
