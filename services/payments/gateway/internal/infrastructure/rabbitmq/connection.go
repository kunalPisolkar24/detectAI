package rabbitmq

import (
	"fmt"
	"gateway/internal/domain/ports"
	"gateway/internal/logger"
	"sync"
	"time"

	amqp "github.com/rabbitmq/amqp091-go"
)

type ConnectionManager struct {
	url             string
	logger          logger.Logger
	dialer          ports.AMQPDialer
	mu              sync.RWMutex
	conn            ports.AMQPConnection
	channel         ports.AMQPChannel
	notifyConnClose chan *amqp.Error
	notifyChanClose chan *amqp.Error
	done            chan bool
	closeOnce       sync.Once
	isConnected     bool
	onConnect       func(ports.AMQPChannel) error
}

func NewConnectionManager(url string, log logger.Logger, onConnect func(ports.AMQPChannel) error) *ConnectionManager {
	return NewConnectionManagerWithDialer(url, log, onConnect, &RealDialer{})
}

func NewConnectionManagerWithDialer(url string, log logger.Logger, onConnect func(ports.AMQPChannel) error, dialer ports.AMQPDialer) *ConnectionManager {
	cm := &ConnectionManager{
		url:       url,
		logger:    log,
		dialer:    dialer,
		onConnect: onConnect,
		done:      make(chan bool),
	}
	go cm.handleReconnect()
	return cm
}

func (cm *ConnectionManager) handleReconnect() {
	for {
		cm.mu.Lock()
		cm.isConnected = false
		cm.mu.Unlock()

		for {
			select {
			case <-cm.done:
				return
			default:
				err := cm.connect()
				if err == nil {
					goto connected
				}
				cm.logger.Error("Failed to connect to RabbitMQ, retrying...", "error", err)
				select {
				case <-cm.done:
					return
				case <-time.After(5 * time.Second):
				}
			}
		}

	connected:
		select {
		case <-cm.done:
			return
		case err := <-cm.notifyConnClose:
			cm.logger.Error("Connection closed, reconnecting", "error", err)
		case err := <-cm.notifyChanClose:
			cm.logger.Error("Channel closed, reconnecting", "error", err)
		}
	}
}

func (cm *ConnectionManager) connect() error {
	conn, err := cm.dialer.Dial(cm.url)
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

	if cm.onConnect != nil {
		if err := cm.onConnect(ch); err != nil {
			ch.Close()
			conn.Close()
			return err
		}
	}

	cm.mu.Lock()
	cm.conn = conn
	cm.channel = ch
	cm.notifyConnClose = make(chan *amqp.Error, 1)
	cm.notifyChanClose = make(chan *amqp.Error, 1)
	cm.conn.NotifyClose(cm.notifyConnClose)
	cm.channel.NotifyClose(cm.notifyChanClose)
	cm.isConnected = true
	cm.mu.Unlock()

	cm.logger.Info("RabbitMQ connected and initialized")
	return nil
}

func (cm *ConnectionManager) GetChannel() (ports.AMQPChannel, error) {
	cm.mu.RLock()
	defer cm.mu.RUnlock()
	if !cm.isConnected {
		return nil, fmt.Errorf("not connected to RabbitMQ")
	}
	return cm.channel, nil
}

func (cm *ConnectionManager) IsConnected() bool {
	cm.mu.RLock()
	defer cm.mu.RUnlock()
	return cm.isConnected
}

func (cm *ConnectionManager) Close() {
	cm.closeOnce.Do(func() {
		close(cm.done)
	})

	cm.mu.Lock()
	defer cm.mu.Unlock()

	if cm.channel != nil {
		cm.channel.Close()
	}
	if cm.conn != nil {
		cm.conn.Close()
	}
	cm.isConnected = false
}
