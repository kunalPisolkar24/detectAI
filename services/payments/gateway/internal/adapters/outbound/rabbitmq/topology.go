package rabbitmq

import (
	"fmt"
	"strings"

	"github.com/kunalPisolkar24/detectAI/services/payments/gateway/internal/ports"
)

func (p *RabbitMQProducer) setupTopology(ch ports.AMQPChannel) error {
	dlxName := p.queueName + "_dlx"
	dlqName := p.queueName + "_dlq"
	retryExchange := p.queueName + "_retry_exchange"
	retryQueue := p.queueName + "_retry"

	if err := ch.ExchangeDeclare(dlxName, "direct", true, false, false, false, nil); err != nil {
		return fmt.Errorf("failed to declare DLX: %w", err)
	}

	dlqArgs := queueArgs(p.queueType)
	if _, err := declareChecked(ch, dlqName, dlqArgs, p.logger); err != nil {
		return fmt.Errorf("failed to declare DLQ: %w", err)
	}
	if err := ch.QueueBind(dlqName, p.queueName, dlxName, false, nil); err != nil {
		return fmt.Errorf("failed to bind DLQ: %w", err)
	}

	if err := ch.ExchangeDeclare(retryExchange, "direct", true, false, false, false, nil); err != nil {
		return fmt.Errorf("failed to declare retry exchange: %w", err)
	}

	retryArgs := ports.Table{
		"x-dead-letter-exchange":    "",
		"x-dead-letter-routing-key": p.queueName,
		"x-message-ttl":             int32(5000),
	}
	if p.queueType == "quorum" {
		retryArgs["x-queue-type"] = "quorum"
	}
	if _, err := declareChecked(ch, retryQueue, retryArgs, p.logger); err != nil {
		return fmt.Errorf("failed to declare retry queue: %w", err)
	}
	if err := ch.QueueBind(retryQueue, retryQueue, retryExchange, false, nil); err != nil {
		return fmt.Errorf("failed to bind retry queue: %w", err)
	}

	mainArgs := ports.Table{
		"x-dead-letter-exchange":    dlxName,
		"x-dead-letter-routing-key": p.queueName,
	}
	if p.queueType == "quorum" {
		mainArgs["x-queue-type"] = "quorum"
	}
	if _, err := declareChecked(ch, p.queueName, mainArgs, p.logger); err != nil {
		return fmt.Errorf("failed to declare main queue: %w", err)
	}
	return nil
}

func queueArgs(queueType string) ports.Table {
	if queueType == "quorum" {
		return ports.Table{"x-queue-type": "quorum"}
	}
	return nil
}

func declareChecked(ch ports.AMQPChannel, name string, args ports.Table, logger ports.Logger) (ports.Queue, error) {
	q, err := ch.QueueDeclare(name, true, false, false, false, args)
	if err != nil && isPreconditionFailed(err) && logger != nil {
		logger.Error("Queue declare 406, quorum vs classic mismatch - delete old queue or use versioned queue payment_events_v2", "queue", name, "error", err)
	}
	return q, err
}

func isPreconditionFailed(err error) bool {
	msg := err.Error()
	return strings.Contains(msg, "PRECONDITION_FAILED") || strings.Contains(msg, "406")
}
