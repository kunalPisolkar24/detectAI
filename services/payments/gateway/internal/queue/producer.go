package queue

import (
	"context"
	"gateway/internal/logger"
	"time"

	amqp "github.com/rabbitmq/amqp091-go"
)

type EventProducer interface {
	Publish(ctx context.Context, body []byte) error
	Close()
	IsConnected() bool
}

type RabbitMQProducer struct {
	conn      *amqp.Connection
	channel   *amqp.Channel
	queueName string
	logger    logger.Logger
}

func NewRabbitMQProducer(url string, queueName string, log logger.Logger) *RabbitMQProducer {
	producer := &RabbitMQProducer{
		queueName: queueName,
		logger:    log,
	}
	producer.connectWithRetry(url)
	return producer
}

func (p *RabbitMQProducer) connectWithRetry(url string) {
	var counts int64
	var backOff = 1 * time.Second

	for {
		conn, err := amqp.Dial(url)
		if err == nil {
			p.conn = conn
			break
		}

		if counts > 10 {
			p.logger.Error("Failed to connect to RabbitMQ", "error", err)
			panic(err)
		}

		counts++
		p.logger.Info("Retrying RabbitMQ connection", "attempt", counts)
		time.Sleep(backOff)
		backOff = backOff * 2
	}

	ch, err := p.conn.Channel()
	if err != nil {
		p.logger.Error("Failed to open channel", "error", err)
		panic(err)
	}

	dlxName := p.queueName + "_dlx"
	dlqName := p.queueName + "_dlq"

	err = ch.ExchangeDeclare(
		dlxName,
		"direct",
		true,
		false,
		false,
		false,
		nil,
	)
	if err != nil {
		p.logger.Error("Failed to declare DLX", "error", err)
		panic(err)
	}

	_, err = ch.QueueDeclare(
		dlqName,
		true,
		false,
		false,
		false,
		nil,
	)
	if err != nil {
		p.logger.Error("Failed to declare DLQ", "error", err)
		panic(err)
	}

	err = ch.QueueBind(
		dlqName,
		p.queueName,
		dlxName,
		false,
		nil,
	)
	if err != nil {
		p.logger.Error("Failed to bind DLQ", "error", err)
		panic(err)
	}

	args := amqp.Table{
		"x-dead-letter-exchange":    dlxName,
		"x-dead-letter-routing-key": p.queueName,
	}

	_, err = ch.QueueDeclare(
		p.queueName,
		true,
		false,
		false,
		false,
		args,
	)
	if err != nil {
		p.logger.Error("Failed to declare main queue", "error", err)
		panic(err)
	}

	p.channel = ch
	p.logger.Info("RabbitMQ connected and topology configured", "queue", p.queueName)
}

func (p *RabbitMQProducer) Publish(ctx context.Context, body []byte) error {
	return p.channel.PublishWithContext(ctx,
		"",
		p.queueName,
		false,
		false,
		amqp.Publishing{
			DeliveryMode: amqp.Persistent,
			ContentType:  "application/json",
			Body:         body,
		})
}

func (p *RabbitMQProducer) Close() {
	if p.channel != nil {
		p.channel.Close()
	}
	if p.conn != nil {
		p.conn.Close()
	}
}

func (p *RabbitMQProducer) IsConnected() bool {
	return p.conn != nil && !p.conn.IsClosed()
}