package mocks

import (
	"context"
	"gateway/internal/queue"
	amqp "github.com/rabbitmq/amqp091-go"
	"github.com/stretchr/testify/mock"
)

type MockAMQPDialer struct {
	mock.Mock
}

func (m *MockAMQPDialer) Dial(url string) (queue.AMQPConnection, error) {
	args := m.Called(url)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(queue.AMQPConnection), args.Error(1)
}

type MockAMQPConnection struct {
	mock.Mock
}

func (m *MockAMQPConnection) Channel() (queue.AMQPChannel, error) {
	args := m.Called()
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(queue.AMQPChannel), args.Error(1)
}

func (m *MockAMQPConnection) NotifyClose(receiver chan *amqp.Error) chan *amqp.Error {
	m.Called(receiver)
	return receiver
}

func (m *MockAMQPConnection) Close() error {
	args := m.Called()
	return args.Error(0)
}

type MockAMQPChannel struct {
	mock.Mock
}

func (m *MockAMQPChannel) Confirm(noWait bool) error {
	args := m.Called(noWait)
	return args.Error(0)
}

func (m *MockAMQPChannel) NotifyClose(receiver chan *amqp.Error) chan *amqp.Error {
	m.Called(receiver)
	return receiver
}

func (m *MockAMQPChannel) NotifyPublish(confirm chan amqp.Confirmation) chan amqp.Confirmation {
	m.Called(confirm)
	return confirm
}

func (m *MockAMQPChannel) QueueDeclare(name string, durable, autoDelete, exclusive, noWait bool, args amqp.Table) (amqp.Queue, error) {
	callArgs := m.Called(name, durable, autoDelete, exclusive, noWait, args)
	return callArgs.Get(0).(amqp.Queue), callArgs.Error(1)
}

func (m *MockAMQPChannel) QueueBind(name, key, exchange string, noWait bool, args amqp.Table) error {
	callArgs := m.Called(name, key, exchange, noWait, args)
	return callArgs.Error(0)
}

func (m *MockAMQPChannel) ExchangeDeclare(name, kind string, durable, autoDelete, internal, noWait bool, args amqp.Table) error {
	callArgs := m.Called(name, kind, durable, autoDelete, internal, noWait, args)
	return callArgs.Error(0)
}

func (m *MockAMQPChannel) PublishWithDeferredConfirmWithContext(ctx context.Context, exchange, key string, mandatory, immediate bool, msg amqp.Publishing) (*amqp.DeferredConfirmation, error) {
	callArgs := m.Called(ctx, exchange, key, mandatory, immediate, msg)
	if callArgs.Get(0) == nil {
		return nil, callArgs.Error(1)
	}
	return callArgs.Get(0).(*amqp.DeferredConfirmation), callArgs.Error(1)
}

func (m *MockAMQPChannel) Close() error {
	args := m.Called()
	return args.Error(0)
}
