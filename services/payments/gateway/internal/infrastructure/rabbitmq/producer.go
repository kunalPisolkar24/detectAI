package rabbitmq

import (
	"context"
	"fmt"
	"gateway/internal/domain/ports"
	"gateway/internal/logger"

	amqp "github.com/rabbitmq/amqp091-go"
)

type RabbitMQProducer struct {
	cm        *ConnectionManager
	queueName string
	queueType string
	logger    logger.Logger
}

func NewRabbitMQProducer(url string, queueName string, queueType string, log logger.Logger) *RabbitMQProducer {
	p := &RabbitMQProducer{
		queueName: queueName,
		queueType: queueType,
		logger:    log,
	}

	p.cm = NewConnectionManager(url, log, p.setupTopology)
	return p
}

func (p *RabbitMQProducer) setupTopology(ch ports.AMQPChannel) error {
	dlxName := p.queueName + "_dlx"
	dlqName := p.queueName + "_dlq"

	if err := ch.ExchangeDeclare(dlxName, "direct", true, false, false, false, nil); err != nil {
		return fmt.Errorf("failed to declare DLX: %w", err)
	}

	if _, err := ch.QueueDeclare(dlqName, true, false, false, false, nil); err != nil {
		return fmt.Errorf("failed to declare DLQ: %w", err)
	}

	if err := ch.QueueBind(dlqName, p.queueName, dlxName, false, nil); err != nil {
		return fmt.Errorf("failed to bind DLQ: %w", err)
	}

	args := amqp.Table{
		"x-dead-letter-exchange":    dlxName,
		"x-dead-letter-routing-key": p.queueName,
	}

	if p.queueType == "quorum" {
		args["x-queue-type"] = "quorum"
	}

	if _, err := ch.QueueDeclare(p.queueName, true, false, false, false, args); err != nil {
		return fmt.Errorf("failed to declare main queue: %w", err)
	}

	return nil
}

func (p *RabbitMQProducer) Publish(ctx context.Context, body []byte) error {
	ch, err := p.cm.GetChannel()
	if err != nil {
		return err
	}

	conf, err := ch.PublishWithDeferredConfirmWithContext(ctx,
		"",
		p.queueName,
		false,
		false,
		amqp.Publishing{
			DeliveryMode: amqp.Persistent,
			ContentType:  "application/json",
			Body:         body,
		})
	if err != nil {
		return err
	}

	select {
	case <-conf.Done():
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