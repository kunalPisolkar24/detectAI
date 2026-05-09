package main

import (
	"gateway/internal/config"
	"gateway/internal/logger"
	"gateway/internal/monitoring"
	"gateway/internal/queue"
	"gateway/internal/server"
	"gateway/internal/validator"
	"os"

	"github.com/gin-gonic/gin"
)

const QueueName = "payment_events"

func main() {
	log := logger.New()
	cfg := config.Load()

	rabbitMQ := queue.NewRabbitMQProducer(cfg.RabbitMQURL, QueueName, log)
	defer rabbitMQ.Close()

	paddleValidator := validator.NewPaddleValidator()

	handler := server.NewHandler(rabbitMQ, paddleValidator, cfg.WebhookSecret, cfg.InternalAPIKey, log)
	monitor := monitoring.New("payment-gateway")

	r := gin.New()
	r.Use(gin.Recovery())
	r.Use(monitor.Middleware())
	r.GET("/metrics", gin.WrapH(monitor.Handler()))

	handler.RegisterRoutes(r)

	log.Info("Gateway starting", "port", cfg.Port)
	if err := r.Run(":" + cfg.Port); err != nil {
		log.Error("Failed to start server", "error", err)
		os.Exit(1)
	}
}
