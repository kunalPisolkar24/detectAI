package rabbitmq

import (
	"errors"
	"gateway/internal/logger"
	"gateway/test/mocks"
	"testing"
	"time"

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

		md.On("Dial", url).Return(mc, nil).Once()
		mc.On("Channel").Return(mch, nil).Once()
		mch.On("Confirm", false).Return(nil).Once()
		mc.On("NotifyClose", mock.Anything).Return(nil).Once()
		mch.On("NotifyClose", mock.Anything).Return(nil).Once()

		cm := NewConnectionManagerWithDialer(url, log, nil, md)
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

		// First dial fails
		md.On("Dial", url).Return(nil, errors.New("connection refused")).Once()
		// Second dial succeeds
		md.On("Dial", url).Return(mc, nil).Once()
		mc.On("Channel").Return(mch, nil).Once()
		mch.On("Confirm", false).Return(nil).Once()
		mc.On("NotifyClose", mock.Anything).Return(nil).Once()
		mch.On("NotifyClose", mock.Anything).Return(nil).Once()

		// Speed up retries for testing
		cm := NewConnectionManagerWithDialer(url, log, nil, md)
		defer cm.Close()

		// Wait for connection loop to succeed eventually
		assert.Eventually(t, func() bool {
			return cm.IsConnected()
		}, 7*time.Second, 100*time.Millisecond) // 5s retry + some buffer
	})
}
