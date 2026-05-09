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
	body := []byte(`{"event_type":"test"}`)
	signature := "valid-sig"

	t.Run("Success", func(t *testing.T) {
		mp := new(mocks.MockEventProducer)
		mv := new(mocks.MockSignatureValidator)
		mr := new(mocks.MockMetricsRecorder)
		s := NewPaymentService(mp, mv, mr, secret)

		mv.On("Validate", signature, body, secret).Return(true).Once()
		mp.On("Publish", mock.Anything, body).Return(nil).Once()
		mr.On("RecordPublish", "test", "success").Once()

		err := s.ProcessWebhook(context.Background(), signature, body)
		assert.NoError(t, err)
		mp.AssertExpectations(t)
		mv.AssertExpectations(t)
	})

	t.Run("Invalid Signature", func(t *testing.T) {
		mp := new(mocks.MockEventProducer)
		mv := new(mocks.MockSignatureValidator)
		mr := new(mocks.MockMetricsRecorder)
		s := NewPaymentService(mp, mv, mr, secret)

		mv.On("Validate", signature, body, secret).Return(false).Once()
		mr.On("RecordInvalidSignature").Once()

		err := s.ProcessWebhook(context.Background(), signature, body)
		assert.Error(t, err)
		assert.Equal(t, "invalid signature", err.Error())
		mp.AssertNotCalled(t, "Publish", mock.Anything, mock.Anything)
	})

	t.Run("Publish Error", func(t *testing.T) {
		mp := new(mocks.MockEventProducer)
		mv := new(mocks.MockSignatureValidator)
		mr := new(mocks.MockMetricsRecorder)
		s := NewPaymentService(mp, mv, mr, secret)

		mv.On("Validate", signature, body, secret).Return(true).Once()
		mp.On("Publish", mock.Anything, body).Return(errors.New("publish failed")).Once()
		mr.On("RecordPublish", "test", "error").Once()

		err := s.ProcessWebhook(context.Background(), signature, body)
		assert.Error(t, err)
		assert.Equal(t, "publish failed", err.Error())
	})
}

func TestPaymentService_ProcessInternalEvent(t *testing.T) {
	body := []byte(`{"event_type":"internal"}`)

	t.Run("Success", func(t *testing.T) {
		mp := new(mocks.MockEventProducer)
		mr := new(mocks.MockMetricsRecorder)
		s := NewPaymentService(mp, nil, mr, "")

		mp.On("Publish", mock.Anything, body).Return(nil).Once()
		mr.On("RecordPublish", "internal", "success").Once()

		err := s.ProcessInternalEvent(context.Background(), body)
		assert.NoError(t, err)
		mp.AssertExpectations(t)
	})

	t.Run("Publish Error", func(t *testing.T) {
		mp := new(mocks.MockEventProducer)
		mr := new(mocks.MockMetricsRecorder)
		s := NewPaymentService(mp, nil, mr, "")

		mp.On("Publish", mock.Anything, body).Return(errors.New("publish failed")).Once()
		mr.On("RecordPublish", "internal", "error").Once()

		err := s.ProcessInternalEvent(context.Background(), body)
		assert.Error(t, err)
		assert.Equal(t, "publish failed", err.Error())
	})
}
