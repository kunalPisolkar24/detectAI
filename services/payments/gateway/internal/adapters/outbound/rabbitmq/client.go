package rabbitmq

import (
	"math/rand"
	"strings"
	"sync"
	"time"

	"github.com/kunalPisolkar24/detectAI/services/payments/gateway/internal/ports"
)

type ConnectionManager struct {
	urls      []string
	logger    ports.Logger
	dialer    ports.AMQPDialer
	metrics   ports.MetricsRecorder
	mu        sync.RWMutex
	conn      ports.AMQPConnection
	channel   ports.AMQPChannel
	notifyConnClose chan error
	notifyChanClose chan error
	done      chan struct{}
	closeOnce sync.Once
	isConnected bool
	onConnect func(ports.AMQPChannel) error
	sleeper   func(time.Duration)
}

func NewConnectionManager(url string, log ports.Logger, metrics ports.MetricsRecorder, onConnect func(ports.AMQPChannel) error) *ConnectionManager {
	return NewConnectionManagerWithDialer(url, log, metrics, onConnect, &RealDialer{})
}

func NewConnectionManagerWithDialer(rawURL string, log ports.Logger, metrics ports.MetricsRecorder, onConnect func(ports.AMQPChannel) error, dialer ports.AMQPDialer) *ConnectionManager {
	urls := splitAndTrim(rawURL)
	cm := &ConnectionManager{
		urls:      urls,
		logger:    log,
		dialer:    dialer,
		metrics:   metrics,
		onConnect: onConnect,
		done:      make(chan struct{}),
		sleeper:   time.Sleep,
	}
	go cm.handleReconnect()
	return cm
}

func splitAndTrim(raw string) []string {
	parts := strings.Split(raw, ",")
	var out []string
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	if len(out) == 0 {
		out = []string{raw}
	}
	return out
}

func (cm *ConnectionManager) handleReconnect() {
	backoff := time.Second
	const maxBackoff = 30 * time.Second

	for {
		cm.setDisconnected()

		for {
			select {
			case <-cm.done:
				return
			default:
			}
			if err := cm.connect(); err == nil {
				backoff = time.Second
				goto connected
			} else {
				if cm.logger != nil {
					cm.logger.Error("Failed to connect to RabbitMQ, retrying...", "error", err, "backoff", backoff)
				}
				jitter := time.Duration(rand.Int63n(1000)) * time.Millisecond
				select {
				case <-cm.done:
					return
				case <-time.After(backoff + jitter):
				}
				backoff *= 2
				if backoff > maxBackoff {
					backoff = maxBackoff
				}
			}
		}

	connected:
		select {
		case <-cm.done:
			return
		case err := <-cm.notifyConnClose:
			if cm.logger != nil {
				cm.logger.Error("Connection closed, reconnecting", "error", err)
			}
			if cm.metrics != nil {
				cm.metrics.RecordRabbitMQReconnection()
			}
		case err := <-cm.notifyChanClose:
			if cm.logger != nil {
				cm.logger.Error("Channel closed, reconnecting", "error", err)
			}
			if cm.metrics != nil {
				cm.metrics.RecordRabbitMQReconnection()
			}
		}
	}
}

func (cm *ConnectionManager) setDisconnected() {
	cm.mu.Lock()
	cm.isConnected = false
	if cm.metrics != nil {
		cm.metrics.SetRabbitMQStatus(false)
	}
	cm.mu.Unlock()
}

func (cm *ConnectionManager) connect() error {
	var lastErr error
	for _, u := range cm.urls {
		conn, err := cm.dialer.Dial(u)
		if err != nil {
			lastErr = err
			continue
		}
		ch, err := conn.Channel()
		if err != nil {
			conn.Close()
			lastErr = err
			continue
		}
		if err := ch.Confirm(false); err != nil {
			ch.Close()
			conn.Close()
			lastErr = err
			continue
		}
		if cm.onConnect != nil {
			if err := cm.onConnect(ch); err != nil {
				ch.Close()
				conn.Close()
				lastErr = err
				continue
			}
		}
		cm.mu.Lock()
		cm.conn = conn
		cm.channel = ch
		cm.notifyConnClose = make(chan error, 1)
		cm.notifyChanClose = make(chan error, 1)
		cm.conn.NotifyClose(cm.notifyConnClose)
		cm.channel.NotifyClose(cm.notifyChanClose)
		cm.isConnected = true
		if cm.metrics != nil {
			cm.metrics.SetRabbitMQStatus(true)
		}
		cm.mu.Unlock()
		if cm.logger != nil {
			cm.logger.Info("RabbitMQ connected and initialized", "url", redactURL(u))
		}
		return nil
	}
	if lastErr != nil {
		return lastErr
	}
	return nil
}

func redactURL(raw string) string {
	if idx := strings.Index(raw, "@"); idx != -1 {
		if schemeIdx := strings.Index(raw, "://"); schemeIdx != -1 {
			return raw[:schemeIdx+3] + "***@" + raw[idx+1:]
		}
	}
	return raw
}

func (cm *ConnectionManager) GetChannel() (ports.AMQPChannel, error) {
	cm.mu.RLock()
	defer cm.mu.RUnlock()
	if !cm.isConnected {
		return nil, ErrNotConnected
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
