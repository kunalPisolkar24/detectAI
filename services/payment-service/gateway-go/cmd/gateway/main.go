package main

import (
	"gateway/internal/config"
	"gateway/internal/queue"
	"gateway/internal/server"
	"gateway/internal/validator"
	"log"

	"github.com/gin-gonic/gin"
)

const QueueName = "payment_events"

func main() {
	cfg := config.Load()

	rabbitMQ := queue.NewRabbitMQProducer(cfg.RabbitMQURL, QueueName)
	defer rabbitMQ.Close()

	paddleValidator := validator.NewPaddleValidator()

	handler := server.NewHandler(rabbitMQ, paddleValidator, cfg.WebhookSecret)

	r := gin.Default()
	handler.RegisterRoutes(r)

	log.Printf("Gateway running on port %s", cfg.Port)
	if err := r.Run(":" + cfg.Port); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}