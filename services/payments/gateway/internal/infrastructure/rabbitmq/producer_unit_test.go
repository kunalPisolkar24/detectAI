package rabbitmq

import (
	"context"
	"errors"
	"gateway/internal/domain/ports"
	"gateway/internal/logger"
	"gateway/test/mocks"
	"sync/atomic"
	"testing"
	"time"

	amqp "github.com/rabbitmq/amqp091-go"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
)

type fakeConfirm struct {
	done   chan struct{}
	acked  bool
	closed atomic.Bool
}

func newFakeConfirm(acked bool) *fakeConfirm {
	f := &fakeConfirm{acked: acked, done: make(chan struct{})}
	return f
}

func (f *fakeConfirm) Done() <-chan struct{} { return f.done }
func (f *fakeConfirm) Acked() bool           { return f.acked }

func (f *fakeConfirm) settle() {
	if f.closed.CompareAndSwap(false, true) {
		close(f.done)
	}
}

func newProducerForPublishTest(t *testing.T) (*RabbitMQProducer, *mocks.MockAMQPDialer, *mocks.MockMetricsRecorder) {
	t.Helper()
	log := logger.New()
	md := new(mocks.MockAMQPDialer)
	mc := new(mocks.MockAMQPConnection)
	mch := new(mocks.MockAMQPChannel)
	mr := new(mocks.MockMetricsRecorder)

	md.On("Dial", mock.Anything).Return(mc, nil).Maybe()
	mc.On("Channel").Return(mch, nil).Maybe()
	mch.On("Confirm", false).Return(nil).Maybe()
	mc.On("NotifyClose", mock.Anything).Return(nil).Maybe()
	mch.On("NotifyClose", mock.Anything).Return(nil).Maybe()
	mch.On("Close").Return(nil).Maybe()
	mc.On("Close").Return(nil).Maybe()
	mr.On("SetRabbitMQStatus", mock.Anything).Return().Maybe()

	mch.On("ExchangeDeclare", mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything).Return(nil).Maybe()
	mch.On("QueueDeclare", mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything).Return(amqp.Queue{}, nil).Maybe()
	mch.On("QueueBind", mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything).Return(nil).Maybe()

	p := &RabbitMQProducer{
		queueName: "payment_events",
		queueType: "classic",
		logger:    log,
		metrics:   mr,
		publish: func(_ ports.AMQPChannel, _ context.Context, _ amqp.Publishing) (deferredConfirm, error) {
			return nil, errors.New("publish factory not overridden")
		},
	}
	p.cm = NewConnectionManagerWithDialer("amqp://guest:guest@localhost:5672/", log, mr, p.setupTopology, md)

	assert.Eventually(t, func() bool { return p.IsConnected() }, 2*time.Second, 50*time.Millisecond)
	t.Cleanup(p.Close)
	return p, md, mr
}

func TestRabbitMQProducer_Publish_Unit(t *testing.T) {
	body := []byte(`{"event_type":"payment.succeeded"}`)

	t.Run("Returns nil when broker acks", func(t *testing.T) {
		p, _, mr := newProducerForPublishTest(t)

		conf := newFakeConfirm(true)
		p.publish = func(_ ports.AMQPChannel, _ context.Context, _ amqp.Publishing) (deferredConfirm, error) {
			conf.settle()
			return conf, nil
		}
		mr.On("RecordRabbitMQPublishDuration", mock.Anything).Return().Once()

		err := p.Publish(context.Background(), body)

		assert.NoError(t, err)
		mr.AssertExpectations(t)
	})

	t.Run("Returns error when broker nacks", func(t *testing.T) {
		p, _, mr := newProducerForPublishTest(t)

		conf := newFakeConfirm(false)
		p.publish = func(_ ports.AMQPChannel, _ context.Context, _ amqp.Publishing) (deferredConfirm, error) {
			conf.settle()
			return conf, nil
		}
		mr.On("RecordRabbitMQPublishDuration", mock.Anything).Return().Once()

		err := p.Publish(context.Background(), body)

		assert.EqualError(t, err, "message nacked by broker")
	})

	t.Run("Returns ctx error when confirmation never settles", func(t *testing.T) {
		p, _, _ := newProducerForPublishTest(t)

		conf := newFakeConfirm(true)
		p.publish = func(_ ports.AMQPChannel, _ context.Context, _ amqp.Publishing) (deferredConfirm, error) {
			return conf, nil
		}

		ctx, cancel := context.WithCancel(context.Background())
		cancel()

		err := p.Publish(ctx, body)

		assert.ErrorIs(t, err, context.Canceled)
	})

	t.Run("Propagates publish errors", func(t *testing.T) {
		p, _, _ := newProducerForPublishTest(t)

		publishErr := errors.New("channel closed")
		p.publish = func(_ ports.AMQPChannel, _ context.Context, _ amqp.Publishing) (deferredConfirm, error) {
			return nil, publishErr
		}

		err := p.Publish(context.Background(), body)

		assert.ErrorIs(t, err, publishErr)
	})
}

func TestRabbitMQProducer_SetupTopology(t *testing.T) {
	tests := []struct {
		name      string
		queueType string
		wantArgs  amqp.Table
	}{
		{
			name:      "Classic queue declares dead letter args only",
			queueType: "classic",
			wantArgs: amqp.Table{
				"x-dead-letter-exchange":    "payment_events_dlx",
				"x-dead-letter-routing-key": "payment_events",
			},
		},
		{
			name:      "Quorum queue adds x-queue-type",
			queueType: "quorum",
			wantArgs: amqp.Table{
				"x-dead-letter-exchange":    "payment_events_dlx",
				"x-dead-letter-routing-key": "payment_events",
				"x-queue-type":              "quorum",
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			log := logger.New()
			p := &RabbitMQProducer{queueName: "payment_events", queueType: tt.queueType, logger: log}
			mch := new(mocks.MockAMQPChannel)

			mch.On("ExchangeDeclare", "payment_events_dlx", "direct", true, false, false, false, amqp.Table(nil)).Return(nil).Once()
			mch.On("QueueDeclare", "payment_events_dlq", true, false, false, false, amqp.Table(nil)).Return(amqp.Queue{}, nil).Once()
			mch.On("QueueBind", "payment_events_dlq", "payment_events", "payment_events_dlx", false, amqp.Table(nil)).Return(nil).Once()
			mch.On("ExchangeDeclare", "payment_events_retry_exchange", "direct", true, false, false, false, amqp.Table(nil)).Return(nil).Once()
			retryArgs := amqp.Table{
				"x-dead-letter-exchange":    "",
				"x-dead-letter-routing-key": "payment_events",
				"x-message-ttl":             int32(5000),
			}
			if tt.queueType == "quorum" {
				retryArgs["x-queue-type"] = "quorum"
			}
			mch.On("QueueDeclare", "payment_events_retry", true, false, false, false, retryArgs).Return(amqp.Queue{}, nil).Once()
			mch.On("QueueBind", "payment_events_retry", "payment_events_retry", "payment_events_retry_exchange", false, amqp.Table(nil)).Return(nil).Once()
			mch.On("QueueDeclare", "payment_events", true, false, false, false, tt.wantArgs).Return(amqp.Queue{}, nil).Once()

			err := p.setupTopology(mch)

			assert.NoError(t, err)
			mch.AssertExpectations(t)
		})
	}
}
