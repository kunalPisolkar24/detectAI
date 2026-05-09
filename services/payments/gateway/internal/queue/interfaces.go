package queue

import (
	amqp "github.com/rabbitmq/amqp091-go"
)

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
	PublishWithDeferredConfirmWithContext(ctx any, exchange, key string, mandatory, immediate bool, msg amqp.Publishing) (*amqp.DeferredConfirmation, error)
	Close() error
}

type RealDialer struct{}

func (d *RealDialer) Dial(url string) (AMQPConnection, error) {
	conn, err := amqp.Dial(url)
	if err != nil {
		return nil, err
	}
	return &RealConnection{conn: conn}, nil
}

type RealConnection struct {
	conn *amqp.Connection
}

func (c *RealConnection) Channel() (AMQPChannel, error) {
	ch, err := c.conn.Channel()
	if err != nil {
		return nil, err
	}
	return &RealChannel{ch: ch}, nil
}

func (c *RealConnection) NotifyClose(receiver chan *amqp.Error) chan *amqp.Error {
	return c.conn.NotifyClose(receiver)
}

func (c *RealConnection) Close() error {
	return c.conn.Close()
}

type RealChannel struct {
	ch *amqp.Channel
}

func (c *RealChannel) Confirm(noWait bool) error {
	return c.ch.Confirm(noWait)
}

func (c *RealChannel) NotifyClose(receiver chan *amqp.Error) chan *amqp.Error {
	return c.ch.NotifyClose(receiver)
}

func (c *RealChannel) NotifyPublish(confirm chan amqp.Confirmation) chan amqp.Confirmation {
	return c.ch.NotifyPublish(confirm)
}

func (c *RealChannel) QueueDeclare(name string, durable, autoDelete, exclusive, noWait bool, args amqp.Table) (amqp.Queue, error) {
	return c.ch.QueueDeclare(name, durable, autoDelete, exclusive, noWait, args)
}

func (c *RealChannel) QueueBind(name, key, exchange string, noWait bool, args amqp.Table) error {
	return c.ch.QueueBind(name, key, exchange, noWait, args)
}

func (c *RealChannel) ExchangeDeclare(name, kind string, durable, autoDelete, internal, noWait bool, args amqp.Table) error {
	return c.ch.ExchangeDeclare(name, kind, durable, autoDelete, internal, noWait, args)
}

func (c *RealChannel) PublishWithDeferredConfirmWithContext(ctx any, exchange, key string, mandatory, immediate bool, msg amqp.Publishing) (*amqp.DeferredConfirmation, error) {
	// The library uses context.Context but I used any to avoid strict dependency in interface if needed, 
	// but context.Context is standard.
	importCtx, ok := ctx.(interface {
		Done() <-chan struct{}
	})
	if !ok {
		// handle error or just cast if we know it's context.Context
	}
	_ = importCtx

	// Actually, the library signature is:
	// func (ch *Channel) PublishWithDeferredConfirmWithContext(ctx context.Context, exchange, key string, mandatory, immediate bool, msg Publishing) (*DeferredConfirmation, error)
	
	// Let's stick to the real library type for simplicity in the implementation
	return c.ch.PublishWithDeferredConfirmWithContext(ctx.(interface{
		Done() <-chan struct{}
		Err() error
	}), exchange, key, mandatory, immediate, msg)
}

func (c *RealChannel) Close() error {
	return c.ch.Close()
}
