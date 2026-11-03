package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/queue"
	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/validator"
)

// NewPaddleWebhook mounts the Paddle ingress face: bounded read, signature
// verify, envelope gate, then one enqueue.
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
		// Presence only: unknown event types and arbitrary data still queue.
		issues := validator.CheckEnvelope(body)
		if len(issues.Missing) > 0 {
			c.JSON(http.StatusUnprocessableEntity, gin.H{
				"error":   "payload rejected by the envelope check",
				"missing": issues.Missing,
			})
			return
		}
		publishResponse(c, publish, publish.Publish(c.Request.Context(), body))
	}
}
