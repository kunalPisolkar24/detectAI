// Package router wires the route surface onto the gin engine.
package router

import (
	"github.com/gin-gonic/gin"

	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/config"
	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/handlers"
)

// New builds the engine: probes at the root, the ingress under /api/v1, and the
// internal face behind the shared x-api-key credential.
func New(cfg config.Config) *gin.Engine {
	r := gin.Default()

	r.GET("/health", handlers.Health)
	r.GET("/ready", handlers.Ready)

	v1 := r.Group("/api/v1")
	v1.POST("/webhook/paddle", handlers.PaddleWebhook)
	v1.POST("/internal/events", RequireAPIKey(cfg.APIKey), handlers.InternalEvent)

	return r
}
