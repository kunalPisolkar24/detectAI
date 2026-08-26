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

		mr.On("RecordWebhookReceived", "test").Once()
		mr.On("RecordSignatureValidationDuration", mock.Anything).Once()
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

		mr.On("RecordWebhookReceived", "test").Once()
		mr.On("RecordSignatureValidationDuration", mock.Anything).Once()
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

		mr.On("RecordWebhookReceived", "test").Once()
		mr.On("RecordSignatureValidationDuration", mock.Anything).Once()
		mv.On("Validate", signature, body, secret).Return(true).Once()
		mp.On("Publish", mock.Anything, body).Return(errors.New("publish failed")).Once()
		mr.On("RecordPublish", "test", "error").Once()

		err := s.ProcessWebhook(context.Background(), signature, body)
		assert.Error(t, err)
		assert.Equal(t, "publish failed", err.Error())
	})

	t.Run("Unknown Event Type", func(t *testing.T) {
		mp := new(mocks.MockEventProducer)
		mv := new(mocks.MockSignatureValidator)
		mr := new(mocks.MockMetricsRecorder)
		s := NewPaymentService(mp, mv, mr, secret)

		unidentified := []byte(`{"foo":"bar"}`)

		mr.On("RecordWebhookReceived", "unknown").Once()
		mr.On("RecordWebhookUnknownEventType").Once()
		mr.On("RecordSignatureValidationDuration", mock.Anything).Once()
		mv.On("Validate", signature, unidentified, secret).Return(true).Once()
		mp.On("Publish", mock.Anything, unidentified).Return(nil).Once()
		mr.On("RecordPublish", "unknown", "success").Once()

		err := s.ProcessWebhook(context.Background(), signature, unidentified)
		assert.NoError(t, err)
	})
}

func TestPaymentService_ExtractEventType(t *testing.T) {
	s := &PaymentService{}

	tests := []struct {
		name string
		body []byte
		want string
	}{
		{
			name: "Prefers event_type",
			body: []byte(`{"event_type":"payment.succeeded","alert_name":"legacy"}`),
			want: "payment.succeeded",
		},
		{
			name: "Falls back to legacy alert_name",
			body: []byte(`{"alert_name":"payment.succeeded"}`),
			want: "payment.succeeded",
		},
		{
			name: "Both missing yields unknown",
			body: []byte(`{"foo":"bar"}`),
			want: "unknown",
		},
		{
			name: "Empty body yields unknown",
			body: []byte(`{}`),
			want: "unknown",
		},
		{
			name: "Malformed JSON yields unknown",
			body: []byte(`{"event_type":`),
			want: "unknown",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, s.extractEventType(tt.body))
		})
	}
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
