package rabbitmq

import (
	"errors"
	"gateway/internal/logger"
	"gateway/test/mocks"
	"sync/atomic"
	"testing"
	"time"

	amqp "github.com/rabbitmq/amqp091-go"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
)

func TestConnectionManager_Connect(t *testing.T) {
	url := "amqp://guest:guest@localhost:5672/"
	log := logger.New()

	t.Run("Successful connection", func(t *testing.T) {
		md := new(mocks.MockAMQPDialer)
		mc := new(mocks.MockAMQPConnection)
		mch := new(mocks.MockAMQPChannel)
		mr := new(mocks.MockMetricsRecorder)

		md.On("Dial", url).Return(mc, nil).Once()
		mc.On("Channel").Return(mch, nil).Once()
		mch.On("Confirm", false).Return(nil).Once()
		mc.On("NotifyClose", mock.Anything).Return(nil).Once()
		mch.On("NotifyClose", mock.Anything).Return(nil).Once()
		mch.On("Close").Return(nil).Once()
		mc.On("Close").Return(nil).Once()
		mr.On("SetRabbitMQStatus", false).Return().Once() // Start of loop
		mr.On("SetRabbitMQStatus", true).Return().Once()  // On success

		cm := NewConnectionManagerWithDialer(url, log, mr, nil, md)
		defer cm.Close()

		// Wait for connection loop
		assert.Eventually(t, func() bool {
			return cm.IsConnected()
		}, 2*time.Second, 100*time.Millisecond)

		ch, err := cm.GetChannel()
		assert.NoError(t, err)
		assert.Equal(t, mch, ch)
	})

	t.Run("Retries on failure", func(t *testing.T) {
		md := new(mocks.MockAMQPDialer)
		mc := new(mocks.MockAMQPConnection)
		mch := new(mocks.MockAMQPChannel)
		mr := new(mocks.MockMetricsRecorder)

		// First dial fails
		md.On("Dial", url).Return(nil, errors.New("connection refused")).Once()
		// Second dial succeeds
		md.On("Dial", url).Return(mc, nil).Once()
		mc.On("Channel").Return(mch, nil).Once()
		mch.On("Confirm", false).Return(nil).Once()
		mc.On("NotifyClose", mock.Anything).Return(nil).Once()
		mch.On("NotifyClose", mock.Anything).Return(nil).Once()
		mch.On("Close").Return(nil).Once()
		mc.On("Close").Return(nil).Once()
		mr.On("SetRabbitMQStatus", false).Return().Run(func(args mock.Arguments) {}).Maybe()
		mr.On("SetRabbitMQStatus", true).Return().Once()

		// Speed up retries for testing
		cm := NewConnectionManagerWithDialer(url, log, mr, nil, md)
		defer cm.Close()

		// Wait for connection loop to succeed eventually
		assert.Eventually(t, func() bool {
			return cm.IsConnected()
		}, 7*time.Second, 100*time.Millisecond) // 5s retry + some buffer
	})

	t.Run("Reconnects on broker-initiated close", func(t *testing.T) {
		md := new(mocks.MockAMQPDialer)
		mc := new(mocks.MockAMQPConnection)
		mch := new(mocks.MockAMQPChannel)
		mr := new(mocks.MockMetricsRecorder)

		var dials int32
		md.On("Dial", url).Run(func(mock.Arguments) { atomic.AddInt32(&dials, 1) }).Return(mc, nil).Twice()
		mc.On("Channel").Return(mch, nil).Twice()
		mch.On("Confirm", false).Return(nil).Twice()
		mc.On("NotifyClose", mock.Anything).Return(nil).Maybe()
		mch.On("NotifyClose", mock.Anything).Return(nil).Maybe()
		mch.On("Close").Return(nil).Maybe()
		mc.On("Close").Return(nil).Maybe()
		mr.On("SetRabbitMQStatus", mock.Anything).Return().Maybe()
		mr.On("RecordRabbitMQReconnection").Return().Once()

		cm := NewConnectionManagerWithDialer(url, log, mr, nil, md)
		defer cm.Close()

		assert.Eventually(t, func() bool {
			return cm.IsConnected()
		}, 2*time.Second, 50*time.Millisecond)

		cm.mu.RLock()
		notifyConnClose := cm.notifyConnClose
		cm.mu.RUnlock()

		notifyConnClose <- &amqp.Error{Reason: "broker shutdown"}

		assert.Eventually(t, func() bool {
			return atomic.LoadInt32(&dials) == 2 && cm.IsConnected()
		}, 5*time.Second, 50*time.Millisecond)

		mr.AssertCalled(t, "RecordRabbitMQReconnection")
	})
}
