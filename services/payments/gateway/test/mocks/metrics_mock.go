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

func (m *MockMetricsRecorder) RecordWebhookReceived(eventType string) {
	m.Called(eventType)
}

func (m *MockMetricsRecorder) RecordWebhookUnknownEventType() {
	m.Called()
}

func (m *MockMetricsRecorder) RecordInternalEventUnauthorized() {
	m.Called()
}

func (m *MockMetricsRecorder) RecordWebhookBodyError(reason string) {
	m.Called(reason)
}

func (m *MockMetricsRecorder) RecordSignatureValidationDuration(seconds float64) {
	m.Called(seconds)
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
