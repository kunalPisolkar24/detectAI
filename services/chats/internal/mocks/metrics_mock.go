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
