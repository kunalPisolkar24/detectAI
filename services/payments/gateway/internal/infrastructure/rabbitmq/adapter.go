package rabbitmq

import (
	"context"
	"gateway/internal/domain/ports"
	amqp "github.com/rabbitmq/amqp091-go"
)

type RealDialer struct{}

func (d *RealDialer) Dial(url string) (ports.AMQPConnection, error) {
	conn, err := amqp.Dial(url)
	if err != nil {
		return nil, err
	}
	return &RealConnection{conn: conn}, nil
}

type RealConnection struct {
	conn *amqp.Connection
}

func (c *RealConnection) Channel() (ports.AMQPChannel, error) {
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

func (c *RealChannel) PublishWithDeferredConfirmWithContext(ctx context.Context, exchange, key string, mandatory, immediate bool, msg amqp.Publishing) (*amqp.DeferredConfirmation, error) {
	return c.ch.PublishWithDeferredConfirmWithContext(ctx, exchange, key, mandatory, immediate, msg)
}

func (c *RealChannel) Close() error {
	return c.ch.Close()
}
