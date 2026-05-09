package main

import (
	"context"
	"gateway/internal/domain"
	"gateway/internal/infrastructure/config"
	"gateway/internal/infrastructure/paddle"
	"gateway/internal/infrastructure/rabbitmq"
	"gateway/internal/logger"
	"gateway/internal/monitoring"
	"gateway/internal/transport/http"
	nethttp "net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
)

const QueueName = "payment_events"

func main() {
	log := logger.New()
	cfg, err := config.Load()
	if err != nil {
		log.Error("Failed to load config", "error", err)
		os.Exit(1)
	}

	rabbitMQ := rabbitmq.NewRabbitMQProducer(cfg.RabbitMQURL, QueueName, cfg.RabbitMQQueueType, log)
	paddleValidator := paddle.NewPaddleValidator()

	paymentService := domain.NewPaymentService(rabbitMQ, paddleValidator, cfg.WebhookSecret)
	handler := http.NewHandler(http.HandlerConfig{
		Service:     paymentService,
		Health:      rabbitMQ,
		InternalKey: cfg.InternalAPIKey,
		Logger:      log,
	})
	monitor := monitoring.New("payment-gateway")

	r := gin.New()
	r.Use(gin.Recovery())
	r.Use(monitor.Middleware())
	r.GET("/metrics", gin.WrapH(monitor.Handler()))

	handler.RegisterRoutes(r)

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
	log.Info("Gateway exited")
}
