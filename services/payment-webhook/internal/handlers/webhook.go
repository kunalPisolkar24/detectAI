package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/queue"
	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/validator"
)

// NewPaddleWebhook mounts the signature validator, the bounded read, and one
// publish call: read, verify, enqueue — the 200 goes out only after SQS
// responded, the SDK response being the durability point (FR-1/FR-2, FR-4).
// The shared read and publish rows live in response.go; the signature row is
// the one mapping site this face alone owns.
func NewPaddleWebhook(v *validator.Paddle, maxBody int64, publish *queue.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		body, err := validator.ReadBounded(c.Request.Body, maxBody)
		if respondReadError(c, err, maxBody) {
			return
		}
		if v.Verify(c.GetHeader("Paddle-Signature"), body) != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
			return
		}
		publishResponse(c, publish, publish.Publish(c.Request.Context(), body, queue.SourcePaddle))
	}
}
