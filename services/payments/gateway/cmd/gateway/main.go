package main

import (
	"context"
	nethttp "net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/kunalPisolkar24/detectAI/services/payments/gateway/internal/adapters/inbound/http"
	"github.com/kunalPisolkar24/detectAI/services/payments/gateway/internal/adapters/outbound/paddle"
	"github.com/kunalPisolkar24/detectAI/services/payments/gateway/internal/adapters/outbound/rabbitmq"
	"github.com/kunalPisolkar24/detectAI/services/payments/gateway/internal/application"
	"github.com/kunalPisolkar24/detectAI/services/payments/gateway/internal/config"
	"github.com/kunalPisolkar24/detectAI/services/payments/gateway/internal/platform/observability"
)

const QueueName = "payment_events"

var (
	buildVersion = "dev"
	buildCommit  = "unknown"
)

func main() {
	cfg, err := config.Load(context.Background())
	if err != nil {
		obsLog := observability.NewLogger("error")
		obsLog.Error("Failed to load config", "error", err, "env_type", os.Getenv("ENV_TYPE"), "redacted_url", config.RedactedRabbitURL(os.Getenv("RABBITMQ_URL")))
		os.Exit(1)
	}

	log := observability.NewLogger(cfg.LogLevel)
	monitor := observability.NewMonitor("payment-gateway")
	monitor.SetBuildInfo(buildVersion, buildCommit)

	shutdownTracing, err := observability.InitTracing(cfg)
	if err != nil {
		log.Error("Failed to initialize tracing", "error", err)
		os.Exit(1)
	}

	log.Info("Gateway config loaded", "port", cfg.Port, "queue_type", cfg.RabbitMQQueueType, "rabbit_url", config.RedactedRabbitURL(cfg.RabbitMQURL), "env_type", cfg.EnvType)

	rabbitMQ := rabbitmq.NewRabbitMQProducer(cfg.RabbitMQURL, QueueName, cfg.RabbitMQQueueType, log, monitor)
	paddleValidator := paddle.NewValidator()

	paymentService := application.NewPaymentService(rabbitMQ, paddleValidator, monitor, cfg.WebhookSecret)
	handler := http.NewHandler(http.HandlerConfig{
		Service:     paymentService,
		Health:      rabbitMQ,
		Metrics:     monitor,
		InternalKey: cfg.InternalAPIKey,
		Logger:      log,
	})

	r := http.SetupRouter(monitor, handler)

	srv := &nethttp.Server{
		Addr:    ":" + cfg.Port,
		Handler: r,
	}

	go func() {
		log.Info("Gateway starting", "port", cfg.Port)
		if err := srv.ListenAndServe(); err != nil && err != nethttp.ErrServerClosed {
			log.Error("Failed to start server", "error", err)
			os.Exit(1)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Info("Shutting down gateway...")

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Error("Server forced to shutdown", "error", err)
	}

	rabbitMQ.Close()

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer shutdownCancel()
	if err := shutdownTracing(shutdownCtx); err != nil {
		log.Error("Failed to flush traces on shutdown", "error", err)
	}

	log.Info("Gateway exited")
}
