// Package router wires the route surface onto the gin engine.
package router

import (
	"github.com/gin-gonic/gin"

	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/config"
	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/handlers"
	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/queue"
	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/validator"
)

// New builds the engine: probes at the root and the single Paddle ingress face
// under /api/v1. The publisher mount comes from the boot composition — main
// wires the SQS adapter; the tests inject a fake. The reader clamps to SQS's
// per-message ceiling so an unshippable body answers the shaped 413 instead of
// surfacing mid-budget as a send fault.
func New(cfg config.Config, publish *queue.Service) *gin.Engine {
	bound := min(cfg.MaxBodyBytes, queue.SQSMessageCeiling)
	r := gin.Default()

	r.GET("/health", handlers.Health)
	r.GET("/ready", handlers.Ready)

	v1 := r.Group("/api/v1")
	v1.POST("/webhook/paddle",
		handlers.NewPaddleWebhook(validator.NewPaddle(cfg.PaddleSecret), bound, publish))

	return r
}
