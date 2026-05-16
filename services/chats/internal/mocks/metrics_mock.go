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

func (m *MockMetricsCollector) SetStreamLag(partition string, lag float64) {
	m.Called(partition, lag)
}
