package rabbitmq

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/kunalPisolkar24/detectAI/services/payments/gateway/internal/domain"
	"github.com/kunalPisolkar24/detectAI/services/payments/gateway/internal/ports"
)

var ErrNotConnected = domain.ErrNotConnected

type deferredConfirm interface {
	Done() <-chan struct{}
	Acked() bool
}

type confirmFactory func(ports.AMQPChannel, context.Context, ports.Publishing) (ports.DeferredConfirmation, error)

type RabbitMQProducer struct {
	cm        *ConnectionManager
	queueName string
	queueType string
	logger    ports.Logger
	metrics   ports.MetricsRecorder
	publish   confirmFactory
}

func NewRabbitMQProducer(url string, queueName string, queueType string, log ports.Logger, metrics ports.MetricsRecorder) *RabbitMQProducer {
	p := &RabbitMQProducer{
		queueName: queueName,
		queueType: queueType,
		logger:    log,
		metrics:   metrics,
	}
	p.publish = func(ch ports.AMQPChannel, ctx context.Context, msg ports.Publishing) (ports.DeferredConfirmation, error) {
		return ch.PublishWithDeferredConfirmWithContext(ctx, "", p.queueName, false, false, msg)
	}
	p.cm = NewConnectionManager(url, log, metrics, p.setupTopology)
	return p
}

func NewRabbitMQProducerWithDialer(url string, queueName string, queueType string, log ports.Logger, metrics ports.MetricsRecorder, dialer ports.AMQPDialer) *RabbitMQProducer {
	p := &RabbitMQProducer{
		queueName: queueName,
		queueType: queueType,
		logger:    log,
		metrics:   metrics,
	}
	p.publish = func(ch ports.AMQPChannel, ctx context.Context, msg ports.Publishing) (ports.DeferredConfirmation, error) {
		return ch.PublishWithDeferredConfirmWithContext(ctx, "", p.queueName, false, false, msg)
	}
	p.cm = NewConnectionManagerWithDialer(url, log, metrics, p.setupTopology, dialer)
	return p
}

func (p *RabbitMQProducer) Publish(ctx context.Context, body []byte) error {
	ch, err := p.cm.GetChannel()
	if err != nil {
		if errors.Is(err, ErrNotConnected) {
			return domain.ErrNotConnected
		}
		return err
	}
	start := time.Now()
	conf, err := p.publish(ch, ctx, ports.Publishing{
		ContentType: "application/json",
		Body:        body,
	})
	if err != nil {
		return err
	}
	select {
	case <-conf.Done():
		if p.metrics != nil {
			p.metrics.RecordRabbitMQPublishDuration(time.Since(start).Seconds())
		}
		if conf.Acked() {
			return nil
		}
		return fmt.Errorf("message nacked by broker")
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (p *RabbitMQProducer) Close() {
	p.cm.Close()
}

func (p *RabbitMQProducer) IsConnected() bool {
	return p.cm.IsConnected()
}
