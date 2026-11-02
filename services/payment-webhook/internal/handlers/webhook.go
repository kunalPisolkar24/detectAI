package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/queue"
	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/validator"
)

// NewPaddleWebhook mounts the signature validator, the bounded read, the
// envelope check, and one publish call: read, verify, gate, enqueue — the 200
// goes out only after SQS responded, the SDK response being the durability
// point (FR-1/FR-2, FR-4). The shared read and publish rows live in
// response.go; the signature and envelope rows are this face alone.
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
		// The envelope gate judges the envelope's presence, never the
		// payload's contents; unknown event types and arbitrary data still
		// queue (FR-7). Advisory signals are unwired until the observability
		// build supplies the counters — never a rejection dimension.
		issues := validator.CheckEnvelope(body)
		if len(issues.Missing) > 0 {
			c.JSON(http.StatusUnprocessableEntity, gin.H{
				"error":   "payload rejected by the envelope check",
				"missing": issues.Missing,
			})
			return
		}
		publishResponse(c, publish, publish.Publish(c.Request.Context(), body, queue.SourcePaddle))
	}
}
