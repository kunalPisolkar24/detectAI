package shutdown

import (
	"context"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/kunalPisolkar24/detectAI/services/chats/pkg/logger"
	"go.uber.org/zap"
)

type Operation func(ctx context.Context) error

type Manager struct {
	ops []Operation
}

func NewManager() *Manager {
	return &Manager{
		ops: make([]Operation, 0),
	}
}

func (m *Manager) Add(op Operation) {
	m.ops = append(m.ops, op)
}

func (m *Manager) WaitForSignal(ctx context.Context) {
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, os.Interrupt, syscall.SIGTERM, syscall.SIGINT)

	select {
	case <-ctx.Done():
		logger.Log.Info("Context cancelled, initiating shutdown")
	case sig := <-quit:
		logger.Log.Info("Signal received, initiating shutdown", zap.String("signal", sig.String()))
	}

	m.performCleanup()
}

func (m *Manager) performCleanup() {
	timeoutCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	for i := len(m.ops) - 1; i >= 0; i-- {
		if err := m.ops[i](timeoutCtx); err != nil {
			logger.Log.Error("Cleanup operation failed", zap.Error(err))
		}
	}
	
	logger.Log.Info("Graceful shutdown completed")
	_ = logger.Log.Sync()
}