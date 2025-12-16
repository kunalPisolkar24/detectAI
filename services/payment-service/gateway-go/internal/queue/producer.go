package queue

import (
	"context"
	"log"
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
}

func NewRabbitMQProducer(url string, queueName string) *RabbitMQProducer {
	producer := &RabbitMQProducer{
		queueName: queueName,
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
			log.Fatalf("Failed to connect to RabbitMQ: %s", err)
		}

		counts++
		time.Sleep(backOff)
		backOff = backOff * 2
	}

	ch, err := p.conn.Channel()
	if err != nil {
		log.Fatalf("Failed to open channel: %s", err)
	}

	_, err = ch.QueueDeclare(
		p.queueName,
		true,
		false,
		false,
		false,
		nil,
	)
	if err != nil {
		log.Fatalf("Failed to declare queue: %s", err)
	}

	p.channel = ch
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