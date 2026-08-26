package domain

import (
	"context"
	"encoding/json"
	"fmt"
	"gateway/internal/domain/ports"
	"time"
)

const unknownEventType = "unknown"

type PaymentService struct {
	publisher     ports.Publisher
	validator     ports.SignatureValidator
	metrics       ports.MetricsRecorder
	webhookSecret string
}

func NewPaymentService(pub ports.Publisher, val ports.SignatureValidator, rec ports.MetricsRecorder, secret string) ports.PaymentService {
	return &PaymentService{
		publisher:     pub,
		validator:     val,
		metrics:       rec,
		webhookSecret: secret,
	}
}

func (s *PaymentService) ProcessWebhook(ctx context.Context, signature string, body []byte) error {
	eventType := s.extractEventType(body)
	s.metrics.RecordWebhookReceived(eventType)

	if eventType == unknownEventType {
		s.metrics.RecordWebhookUnknownEventType()
	}

	start := time.Now()
	valid := s.validator.Validate(signature, body, s.webhookSecret)
	s.metrics.RecordSignatureValidationDuration(time.Since(start).Seconds())

	if !valid {
		s.metrics.RecordInvalidSignature()
		return fmt.Errorf("invalid signature")
	}

	err := s.publisher.Publish(ctx, body)
	if err != nil {
		s.metrics.RecordPublish(eventType, "error")
		return err
	}

	s.metrics.RecordPublish(eventType, "success")
	return nil
}

func (s *PaymentService) ProcessInternalEvent(ctx context.Context, body []byte) error {
	eventType := s.extractEventType(body)
	err := s.publisher.Publish(ctx, body)
	if err != nil {
		s.metrics.RecordPublish(eventType, "error")
		return err
	}

	s.metrics.RecordPublish(eventType, "success")
	return nil
}

func (s *PaymentService) extractEventType(body []byte) string {
	var payload struct {
		EventType string `json:"event_type"`
		AlertName string `json:"alert_name"` // For legacy Paddle webhooks
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return unknownEventType
	}

	if payload.EventType != "" {
		return payload.EventType
	}
	if payload.AlertName != "" {
		return payload.AlertName
	}
	return unknownEventType
}
