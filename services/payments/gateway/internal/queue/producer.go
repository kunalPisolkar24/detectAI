package queue

import (
	"context"
	"fmt"
	"gateway/internal/logger"
	"sync"
	"time"

	amqp "github.com/rabbitmq/amqp091-go"
)

type EventProducer interface {
	Publish(ctx context.Context, body []byte) error
	Close()
	IsConnected() bool
}

type RabbitMQProducer struct {
	url           string
	conn          *amqp.Connection
	channel       *amqp.Channel
	queueName     string
	logger        logger.Logger
	mu            sync.RWMutex
	done          chan bool
	notifyConnClose  chan *amqp.Error
	notifyChanClose  chan *amqp.Error
	notifyConfirm    chan amqp.Confirmation
	isConnected   bool
}

func NewRabbitMQProducer(url string, queueName string, log logger.Logger) *RabbitMQProducer {
	p := &RabbitMQProducer{
		url:       url,
		queueName: queueName,
		logger:    log,
		done:      make(chan bool),
	}
	go p.handleReconnect()
	return p
}

func (p *RabbitMQProducer) handleReconnect() {
	for {
		p.mu.Lock()
		p.isConnected = false
		p.mu.Unlock()

		p.logger.Info("Attempting to connect to RabbitMQ")
		for {
			err := p.connect()
			if err == nil {
				break
			}
			p.logger.Error("Failed to connect to RabbitMQ, retrying...", "error", err)
			select {
			case <-p.done:
				return
			case <-time.After(5 * time.Second):
			}
		}

		select {
		case <-p.done:
			return
		case err := <-p.notifyConnClose:
			p.logger.Error("Connection closed, reconnecting", "error", err)
		case err := <-p.notifyChanClose:
			p.logger.Error("Channel closed, reconnecting", "error", err)
		}
	}
}

func (p *RabbitMQProducer) connect() error {
	conn, err := amqp.Dial(p.url)
	if err != nil {
		return err
	}

	ch, err := conn.Channel()
	if err != nil {
		conn.Close()
		return err
	}

	if err := ch.Confirm(false); err != nil {
		ch.Close()
		conn.Close()
		return err
	}

	p.mu.Lock()
	p.conn = conn
	p.channel = ch
	p.notifyConnClose = make(chan *amqp.Error, 1)
	p.notifyChanClose = make(chan *amqp.Error, 1)
	p.notifyConfirm = make(chan amqp.Confirmation, 1)
	p.conn.NotifyClose(p.notifyConnClose)
	p.channel.NotifyClose(p.notifyChanClose)
	p.channel.NotifyPublish(p.notifyConfirm)
	p.mu.Unlock()

	if err := p.setupTopology(ch); err != nil {
		p.Close()
		return err
	}

	p.mu.Lock()
	p.isConnected = true
	p.mu.Unlock()

	p.logger.Info("RabbitMQ connected and topology configured")
	return nil
}

func (p *RabbitMQProducer) setupTopology(ch *amqp.Channel) error {
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

	if _, err := ch.QueueDeclare(p.queueName, true, false, false, false, args); err != nil {
		return fmt.Errorf("failed to declare main queue: %w", err)
	}

	return nil
}

func (p *RabbitMQProducer) Publish(ctx context.Context, body []byte) error {
	p.mu.RLock()
	if !p.isConnected {
		p.mu.RUnlock()
		return fmt.Errorf("not connected to RabbitMQ")
	}
	ch := p.channel
	confirmCh := p.notifyConfirm
	p.mu.RUnlock()

	err := ch.PublishWithContext(ctx,
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
	case confirm := <-confirmCh:
		if confirm.Ack {
			return nil
		}
		return fmt.Errorf("message nacked by broker")
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (p *RabbitMQProducer) Close() {
	p.mu.Lock()
	defer p.mu.Unlock()

	if !p.isConnected {
		return
	}

	close(p.done)
	if p.channel != nil {
		p.channel.Close()
	}
	if p.conn != nil {
		p.conn.Close()
	}
	p.isConnected = false
}

func (p *RabbitMQProducer) IsConnected() bool {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.isConnected
}