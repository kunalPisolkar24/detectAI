// Package router wires the route surface onto the gin engine.
package router

import (
	"github.com/gin-gonic/gin"

	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/config"
	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/handlers"
	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/observability"
	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/queue"
	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/validator"
)

// New builds the engine; the webhook read bound clamps to the SQS message
// ceiling so an unshippable body answers 413 instead of faulting mid-publish.
func New(cfg config.Config, publish *queue.Service, obs observability.Telemetry) *gin.Engine {
	bound := min(cfg.MaxBodyBytes, queue.SQSMessageCeiling)
	r := gin.Default()
	observability.Wire(obs, r)

	v1 := r.Group("/api/v1")
	v1.GET("/health", handlers.Health)
	v1.GET("/ready", handlers.Ready)
	v1.POST("/webhook/paddle",
		handlers.NewPaddleWebhook(validator.NewPaddle(cfg.PaddleSecret), bound, publish, obs))

	return r
}
