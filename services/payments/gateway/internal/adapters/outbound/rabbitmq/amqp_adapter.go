package rabbitmq

import (
	"context"
	"crypto/tls"
	"net/url"
	"strings"

	"github.com/kunalPisolkar24/detectAI/services/payments/gateway/internal/ports"
	amqp "github.com/rabbitmq/amqp091-go"
)

type RealDialer struct{}

func (d *RealDialer) Dial(rawURL string) (ports.AMQPConnection, error) {
	rawURL = strings.TrimSpace(rawURL)
	urls := strings.Split(rawURL, ",")
	var lastErr error
	for _, u := range urls {
		u = strings.TrimSpace(u)
		if u == "" {
			continue
		}
		conn, err := dialSingle(u)
		if err == nil {
			return &RealConnection{conn: conn}, nil
		}
		lastErr = err
		if !isConnectionError(err) {
			return nil, err
		}
	}
	if lastErr != nil {
		return nil, lastErr
	}
	conn, err := dialSingle(strings.TrimSpace(urls[0]))
	if err != nil {
		return nil, err
	}
	return &RealConnection{conn: conn}, nil
}

func dialSingle(rawURL string) (*amqp.Connection, error) {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return amqp.Dial(rawURL)
	}
	if parsed.Scheme == "amqps" {
		cfg := &tls.Config{MinVersion: tls.VersionTLS12}
		return amqp.DialTLS(rawURL, cfg)
	}
	return amqp.Dial(rawURL)
}

func isConnectionError(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return strings.Contains(msg, "dial") || strings.Contains(msg, "connection")
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

func (c *RealConnection) NotifyClose(receiver chan error) chan error {
	notify := make(chan *amqp.Error, 1)
	out := c.conn.NotifyClose(notify)
	go func() {
		for e := range out {
			if e == nil {
				receiver <- nil
			} else {
				receiver <- e
			}
			close(receiver)
			return
		}
		close(receiver)
	}()
	return receiver
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

func (c *RealChannel) NotifyClose(receiver chan error) chan error {
	notify := make(chan *amqp.Error, 1)
	out := c.ch.NotifyClose(notify)
	go func() {
		for e := range out {
			if e == nil {
				receiver <- nil
			} else {
				receiver <- e
			}
			close(receiver)
			return
		}
		close(receiver)
	}()
	return receiver
}

func (c *RealChannel) QueueDeclare(name string, durable, autoDelete, exclusive, noWait bool, args ports.Table) (ports.Queue, error) {
	q, err := c.ch.QueueDeclare(name, durable, autoDelete, exclusive, noWait, amqp.Table(args))
	if err != nil {
		return ports.Queue{}, err
	}
	return ports.Queue{Name: q.Name}, nil
}

func (c *RealChannel) QueueBind(name, key, exchange string, noWait bool, args ports.Table) error {
	return c.ch.QueueBind(name, key, exchange, noWait, amqp.Table(args))
}

func (c *RealChannel) ExchangeDeclare(name, kind string, durable, autoDelete, internal, noWait bool, args ports.Table) error {
	return c.ch.ExchangeDeclare(name, kind, durable, autoDelete, internal, noWait, amqp.Table(args))
}

func (c *RealChannel) PublishWithDeferredConfirmWithContext(ctx context.Context, exchange, key string, mandatory, immediate bool, msg ports.Publishing) (ports.DeferredConfirmation, error) {
	amqpMsg := amqp.Publishing{
		DeliveryMode: amqp.Persistent,
		ContentType:  msg.ContentType,
		Body:         msg.Body,
	}
	dc, err := c.ch.PublishWithDeferredConfirmWithContext(ctx, exchange, key, mandatory, immediate, amqpMsg)
	if err != nil {
		return nil, err
	}
	return &deferredAdapter{dc: dc}, nil
}

func (c *RealChannel) Close() error {
	return c.ch.Close()
}

type deferredAdapter struct {
	dc *amqp.DeferredConfirmation
}

func (d *deferredAdapter) Done() <-chan struct{} {
	return d.dc.Done()
}

func (d *deferredAdapter) Acked() bool {
	return d.dc.Acked()
}
