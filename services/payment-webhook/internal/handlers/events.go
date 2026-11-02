package handlers

import (
	"github.com/gin-gonic/gin"

	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/queue"
	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/validator"
)

// NewInternalEvent serves the apps/web face: the same bounded read and one
// publish call as the Paddle face, minus the signature rules — auth is the
// mounted x-api-key guard's work (http.md internal face).
func NewInternalEvent(publish *queue.Service, maxBody int64) gin.HandlerFunc {
	return func(c *gin.Context) {
		body, err := validator.ReadBounded(c.Request.Body, maxBody)
		if respondReadError(c, err, maxBody) {
			return
		}
		publishResponse(c, publish, publish.Publish(c.Request.Context(), body, queue.SourceInternal))
	}
}
