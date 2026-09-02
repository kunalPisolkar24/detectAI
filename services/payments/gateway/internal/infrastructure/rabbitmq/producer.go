package rabbitmq

import (
	"context"
	"fmt"
	"gateway/internal/domain/ports"
	"gateway/internal/logger"
	"strings"
	"time"

	amqp "github.com/rabbitmq/amqp091-go"
)

type deferredConfirm interface {
	Done() <-chan struct{}
	Acked() bool
}

type confirmFactory func(ports.AMQPChannel, context.Context, amqp.Publishing) (deferredConfirm, error)

type RabbitMQProducer struct {
	cm        *ConnectionManager
	queueName string
	queueType string
	logger    logger.Logger
	metrics   ports.MetricsRecorder
	publish   confirmFactory
}

func NewRabbitMQProducer(url string, queueName string, queueType string, log logger.Logger, metrics ports.MetricsRecorder) *RabbitMQProducer {
	p := &RabbitMQProducer{
		queueName: queueName,
		queueType: queueType,
		logger:    log,
		metrics:   metrics,
	}

	p.publish = func(ch ports.AMQPChannel, ctx context.Context, msg amqp.Publishing) (deferredConfirm, error) {
		return ch.PublishWithDeferredConfirmWithContext(ctx, "", p.queueName, false, false, msg)
	}

	p.cm = NewConnectionManager(url, log, metrics, p.setupTopology)
	return p
}

func (p *RabbitMQProducer) setupTopology(ch ports.AMQPChannel) error {
	dlxName := p.queueName + "_dlx"
	dlqName := p.queueName + "_dlq"
	retryExchange := p.queueName + "_retry_exchange"
	retryQueue := p.queueName + "_retry"

	if err := ch.ExchangeDeclare(dlxName, "direct", true, false, false, false, nil); err != nil {
		return fmt.Errorf("failed to declare DLX: %w", err)
	}

	if _, err := ch.QueueDeclare(dlqName, true, false, false, false, nil); err != nil {
		return fmt.Errorf("failed to declare DLQ: %w", err)
	}

	if err := ch.QueueBind(dlqName, p.queueName, dlxName, false, nil); err != nil {
		return fmt.Errorf("failed to bind DLQ: %w", err)
	}

	if err := ch.ExchangeDeclare(retryExchange, "direct", true, false, false, false, nil); err != nil {
		return fmt.Errorf("failed to declare retry exchange: %w", err)
	}

	retryArgs := amqp.Table{
		"x-dead-letter-exchange":    "",
		"x-dead-letter-routing-key": p.queueName,
		"x-message-ttl":             int32(5000),
	}
	if p.queueType == "quorum" {
		retryArgs["x-queue-type"] = "quorum"
	}
	if _, err := ch.QueueDeclare(retryQueue, true, false, false, false, retryArgs); err != nil {
		if isPreconditionFailed(err) {
			p.logger.Error("Queue declare 406, quorum vs classic mismatch - delete old queue or use versioned queue payment_events_v2", "queue", retryQueue, "error", err)
		}
		return fmt.Errorf("failed to declare retry queue: %w", err)
	}
	if err := ch.QueueBind(retryQueue, retryQueue, retryExchange, false, nil); err != nil {
		return fmt.Errorf("failed to bind retry queue: %w", err)
	}

	args := amqp.Table{
		"x-dead-letter-exchange":    dlxName,
		"x-dead-letter-routing-key": p.queueName,
	}

	if p.queueType == "quorum" {
		args["x-queue-type"] = "quorum"
	}

	if _, err := ch.QueueDeclare(p.queueName, true, false, false, false, args); err != nil {
		if isPreconditionFailed(err) {
			p.logger.Error("Queue declare 406, quorum vs classic mismatch - delete old queue or use versioned queue payment_events_v2", "queue", p.queueName, "error", err)
		}
		return fmt.Errorf("failed to declare main queue: %w", err)
	}

	return nil
}

func isPreconditionFailed(err error) bool {
	msg := err.Error()
	return strings.Contains(msg, "PRECONDITION_FAILED") || strings.Contains(msg, "406")
}

func (p *RabbitMQProducer) Publish(ctx context.Context, body []byte) error {
	ch, err := p.cm.GetChannel()
	if err != nil {
		return err
	}

	start := time.Now()
	conf, err := p.publish(ch, ctx, amqp.Publishing{
		DeliveryMode: amqp.Persistent,
		ContentType:  "application/json",
		Body:         body,
	})
	if err != nil {
		return err
	}

	select {
	case <-conf.Done():
		p.metrics.RecordRabbitMQPublishDuration(time.Since(start).Seconds())
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