package mocks

import "github.com/stretchr/testify/mock"

type MockMetricsCollector struct {
	mock.Mock
}

func (m *MockMetricsCollector) IncCacheHit() {
	m.Called()
}

func (m *MockMetricsCollector) IncCacheMiss() {
	m.Called()
}

func (m *MockMetricsCollector) AddIngestedMessages(count float64) {
	m.Called(count)
}

func (m *MockMetricsCollector) IncPublishedMessages(count float64) {
	m.Called(count)
}

func (m *MockMetricsCollector) SetStreamLag(partition string, lag float64) {
	m.Called(partition, lag)
}

func (m *MockMetricsCollector) IncDLQMessages(count float64) {
	m.Called(count)
}

func (m *MockMetricsCollector) IncStreamErrors(operation string) {
	m.Called(operation)
}

func (m *MockMetricsCollector) IncDatabaseErrors(operation string) {
	m.Called(operation)
}
