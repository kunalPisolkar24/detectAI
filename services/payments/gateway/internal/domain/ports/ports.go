package ports

import (
	"context"
	amqp "github.com/rabbitmq/amqp091-go"
)

// Infrastructure Ports (Outbound)

type AMQPDialer interface {
	Dial(url string) (AMQPConnection, error)
}

type AMQPConnection interface {
	Channel() (AMQPChannel, error)
	NotifyClose(receiver chan *amqp.Error) chan *amqp.Error
	Close() error
}

type AMQPChannel interface {
	Confirm(noWait bool) error
	NotifyClose(receiver chan *amqp.Error) chan *amqp.Error
	NotifyPublish(confirm chan amqp.Confirmation) chan amqp.Confirmation
	QueueDeclare(name string, durable, autoDelete, exclusive, noWait bool, args amqp.Table) (amqp.Queue, error)
	QueueBind(name, key, exchange string, noWait bool, args amqp.Table) error
	ExchangeDeclare(name, kind string, durable, autoDelete, internal, noWait bool, args amqp.Table) error
	PublishWithDeferredConfirmWithContext(ctx context.Context, exchange, key string, mandatory, immediate bool, msg amqp.Publishing) (*amqp.DeferredConfirmation, error)
	Close() error
}

type Publisher interface {
	Publish(ctx context.Context, body []byte) error
}

type SignatureValidator interface {
	Validate(signatureHeader string, body []byte, secret string) bool
}

type HealthChecker interface {
	IsConnected() bool
}

// Service Ports (Inbound)

type PaymentService interface {
	ProcessWebhook(ctx context.Context, signature string, body []byte) error
	ProcessInternalEvent(ctx context.Context, body []byte) error
}
