package mocks

import "github.com/stretchr/testify/mock"

type MockMetricsRecorder struct {
	mock.Mock
}

func (m *MockMetricsRecorder) RecordPublish(eventType, status string) {
	m.Called(eventType, status)
}

func (m *MockMetricsRecorder) RecordInvalidSignature() {
	m.Called()
}

func (m *MockMetricsRecorder) SetRabbitMQStatus(connected bool) {
	m.Called(connected)
}

func (m *MockMetricsRecorder) RecordRabbitMQPublishDuration(duration float64) {
	m.Called(duration)
}

func (m *MockMetricsRecorder) RecordRabbitMQReconnection() {
	m.Called()
}
