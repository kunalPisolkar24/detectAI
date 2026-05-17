package mocks

import (
	"github.com/stretchr/testify/mock"
)

type MockSignatureValidator struct {
	mock.Mock
}

func (m *MockSignatureValidator) Validate(signatureHeader string, body []byte, secret string) bool {
	args := m.Called(signatureHeader, body, secret)
	return args.Bool(0)
}