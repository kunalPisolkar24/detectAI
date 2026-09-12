package domain

import "errors"

var (
	ErrInvalidSignature = errors.New("invalid signature")
	ErrNotConnected     = errors.New("not connected to RabbitMQ")
	ErrTooLarge         = errors.New("request body too large")
)
