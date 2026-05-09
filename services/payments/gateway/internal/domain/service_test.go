package domain

import (
	"context"
	"errors"
	"gateway/test/mocks"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
)

func TestPaymentService_ProcessWebhook(t *testing.T) {
	secret := "test-secret"
	body := []byte(`{"event":"test"}`)
	signature := "valid-sig"

	t.Run("Success", func(t *testing.T) {
		mp := new(mocks.MockEventProducer)
		mv := new(mocks.MockSignatureValidator)
		s := NewPaymentService(mp, mv, secret)

		mv.On("Validate", signature, body, secret).Return(true).Once()
		mp.On("Publish", mock.Anything, body).Return(nil).Once()

		err := s.ProcessWebhook(context.Background(), signature, body)
		assert.NoError(t, err)
		mp.AssertExpectations(t)
		mv.AssertExpectations(t)
	})

	t.Run("Invalid Signature", func(t *testing.T) {
		mp := new(mocks.MockEventProducer)
		mv := new(mocks.MockSignatureValidator)
		s := NewPaymentService(mp, mv, secret)

		mv.On("Validate", signature, body, secret).Return(false).Once()

		err := s.ProcessWebhook(context.Background(), signature, body)
		assert.Error(t, err)
		assert.Equal(t, "invalid signature", err.Error())
		mp.AssertNotCalled(t, "Publish", mock.Anything, mock.Anything)
	})

	t.Run("Publish Error", func(t *testing.T) {
		mp := new(mocks.MockEventProducer)
		mv := new(mocks.MockSignatureValidator)
		s := NewPaymentService(mp, mv, secret)

		mv.On("Validate", signature, body, secret).Return(true).Once()
		mp.On("Publish", mock.Anything, body).Return(errors.New("publish failed")).Once()

		err := s.ProcessWebhook(context.Background(), signature, body)
		assert.Error(t, err)
		assert.Equal(t, "publish failed", err.Error())
	})
}

func TestPaymentService_ProcessInternalEvent(t *testing.T) {
	body := []byte(`{"event":"internal"}`)

	t.Run("Success", func(t *testing.T) {
		mp := new(mocks.MockEventProducer)
		s := NewPaymentService(mp, nil, "")

		mp.On("Publish", mock.Anything, body).Return(nil).Once()

		err := s.ProcessInternalEvent(context.Background(), body)
		assert.NoError(t, err)
		mp.AssertExpectations(t)
	})

	t.Run("Publish Error", func(t *testing.T) {
		mp := new(mocks.MockEventProducer)
		s := NewPaymentService(mp, nil, "")

		mp.On("Publish", mock.Anything, body).Return(errors.New("publish failed")).Once()

		err := s.ProcessInternalEvent(context.Background(), body)
		assert.Error(t, err)
		assert.Equal(t, "publish failed", err.Error())
	})
}
