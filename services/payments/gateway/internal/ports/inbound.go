package ports

import "context"

type PaymentService interface {
	ProcessWebhook(ctx context.Context, signature string, body []byte) error
	ProcessInternalEvent(ctx context.Context, body []byte) error
}
