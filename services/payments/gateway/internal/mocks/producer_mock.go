package mocks

import (
	"context"
	"github.com/stretchr/testify/mock"
)

type MockEventProducer struct {
	mock.Mock
}

func (m *MockEventProducer) Publish(ctx context.Context, body []byte) error {
	args := m.Called(ctx, body)
	return args.Error(0)
}

func (m *MockEventProducer) Close() {
	m.Called()
}

func (m *MockEventProducer) IsConnected() bool {
	args := m.Called()
	return args.Bool(0)
}