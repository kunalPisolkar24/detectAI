package handlers

import (
	"errors"
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/validator"
)

// NewPaddleWebhook mounts the signature validator over the bounded read: read,
// then verify, then the 200 envelope (FR-1/FR-2, NFR-4). The validator answers
// failure classes; the statuses and bodies stay here — the one mapping site
// this face owns.
func NewPaddleWebhook(v *validator.Paddle, maxBody int64) gin.HandlerFunc {
	return func(c *gin.Context) {
		body, err := validator.ReadBounded(c.Request.Body, maxBody)
		switch {
		case errors.Is(err, validator.ErrBodyTooLarge):
			c.JSON(http.StatusRequestEntityTooLarge,
				gin.H{"error": fmt.Sprintf("request body exceeds %d bytes", maxBody)})
		case errors.Is(err, validator.ErrBodyMalformed):
			c.JSON(http.StatusBadRequest, gin.H{"error": "request body is unreadable"})
		case v.Verify(c.GetHeader("Paddle-Signature"), body) != nil:
			c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		default:
			c.JSON(http.StatusOK, gin.H{"status": "queued"})
		}
	}
}
