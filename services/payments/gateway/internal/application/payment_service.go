package application

import (
	"context"
	"time"

	"github.com/kunalPisolkar24/detectAI/services/payments/gateway/internal/domain"
	"github.com/kunalPisolkar24/detectAI/services/payments/gateway/internal/ports"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
)

var tracer = otel.Tracer("payment-gateway/application")

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
	ctx, span := tracer.Start(ctx, "PaymentService.ProcessWebhook")
	defer span.End()

	evt := domain.ParseEvent(body)
	span.SetAttributes(
		attribute.String("event_type", evt.Type),
		attribute.String("event_id", evt.ID),
		attribute.String("source", "paddle"),
	)
	s.metrics.RecordWebhookReceived(evt.Type)
	if evt.Type == domain.UnknownEventType {
		s.metrics.RecordWebhookUnknownEventType()
	}

	start := time.Now()
	valid := s.validator.Validate(signature, body, s.webhookSecret)
	s.metrics.RecordSignatureValidationDuration(time.Since(start).Seconds())

	if !valid {
		s.metrics.RecordInvalidSignature()
		span.SetStatus(codes.Error, "invalid signature")
		return domain.ErrInvalidSignature
	}

	if err := s.publishWithMetrics(ctx, evt.Type, body, span); err != nil {
		return err
	}
	return nil
}

func (s *PaymentService) ProcessInternalEvent(ctx context.Context, body []byte) error {
	ctx, span := tracer.Start(ctx, "PaymentService.ProcessInternalEvent")
	defer span.End()

	evt := domain.ParseEvent(body)
	span.SetAttributes(
		attribute.String("event_type", evt.Type),
		attribute.String("event_id", evt.ID),
		attribute.String("source", "internal"),
	)

	if err := s.publishWithMetrics(ctx, evt.Type, body, span); err != nil {
		return err
	}
	return nil
}

func (s *PaymentService) publishWithMetrics(ctx context.Context, eventType string, body []byte, span interface {
	SetAttributes(...attribute.KeyValue)
}) error {
	err := s.publisher.Publish(ctx, body)
	if err != nil {
		s.metrics.RecordPublish(eventType, "error")
		span.SetAttributes(attribute.String("publish_status", "error"))
		return err
	}
	s.metrics.RecordPublish(eventType, "success")
	span.SetAttributes(attribute.String("publish_status", "success"))
	return nil
}
