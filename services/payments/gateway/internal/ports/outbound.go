package ports

import "context"

type Publisher interface {
	Publish(ctx context.Context, body []byte) error
}

type SignatureValidator interface {
	Validate(signatureHeader string, body []byte, secret string) bool
}

type HealthChecker interface {
	IsConnected() bool
}
