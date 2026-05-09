package domain

import (
	"context"
	"fmt"
	"gateway/internal/domain/ports"
)

type PaymentService struct {
	publisher     ports.Publisher
	validator     ports.SignatureValidator
	webhookSecret string
}

func NewPaymentService(pub ports.Publisher, val ports.SignatureValidator, secret string) ports.PaymentService {
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
