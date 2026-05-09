package domain

import (
	"context"
	"fmt"
)

type Publisher interface {
	Publish(ctx context.Context, body []byte) error
}

type SignatureValidator interface {
	Validate(signatureHeader string, body []byte, secret string) bool
}

type PaymentServiceInterface interface {
	ProcessWebhook(ctx context.Context, signature string, body []byte) error
	ProcessInternalEvent(ctx context.Context, body []byte) error
}

type PaymentService struct {
	publisher     Publisher
	validator     SignatureValidator
	webhookSecret string
}

func NewPaymentService(pub Publisher, val SignatureValidator, secret string) *PaymentService {
	return &PaymentService{
		publisher:     pub,
		validator:     val,
		webhookSecret: secret,
	}
}

func (s *PaymentService) ProcessWebhook(ctx context.Context, signature string, body []byte) error {
	if !s.validator.Validate(signature, body, s.webhookSecret) {
		return fmt.Errorf("invalid signature")
	}

	return s.publisher.Publish(ctx, body)
}

func (s *PaymentService) ProcessInternalEvent(ctx context.Context, body []byte) error {
	return s.publisher.Publish(ctx, body)
}
