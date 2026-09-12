package ports

import "context"

type Queue struct {
	Name string
}

type Table map[string]interface{}

type Publishing struct {
	ContentType string
	Body        []byte
}

type Confirmation struct {
	Ack bool
}

type DeferredConfirmation interface {
	Done() <-chan struct{}
	Acked() bool
}

type AMQPDialer interface {
	Dial(url string) (AMQPConnection, error)
}

type AMQPConnection interface {
	Channel() (AMQPChannel, error)
	NotifyClose(receiver chan error) chan error
	Close() error
}

type AMQPChannel interface {
	Confirm(noWait bool) error
	NotifyClose(receiver chan error) chan error
	QueueDeclare(name string, durable, autoDelete, exclusive, noWait bool, args Table) (Queue, error)
	QueueBind(name, key, exchange string, noWait bool, args Table) error
	ExchangeDeclare(name, kind string, durable, autoDelete, internal, noWait bool, args Table) error
	PublishWithDeferredConfirmWithContext(ctx context.Context, exchange, key string, mandatory, immediate bool, msg Publishing) (DeferredConfirmation, error)
	Close() error
}
