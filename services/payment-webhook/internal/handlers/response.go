package handlers

import (
	"errors"
	"fmt"
	"math"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/queue"
	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/validator"
)

// respondReadError maps bounded-read failures to 413/400; it reports whether a response was written.
func respondReadError(c *gin.Context, err error, maxBody int64) bool {
	switch {
	case errors.Is(err, validator.ErrBodyTooLarge):
		c.JSON(http.StatusRequestEntityTooLarge,
			gin.H{"error": fmt.Sprintf("request body exceeds %d bytes", maxBody)})
		return true
	case errors.Is(err, validator.ErrBodyMalformed):
		c.JSON(http.StatusBadRequest, gin.H{"error": "request body is unreadable"})
		return true
	default:
		return false
	}
}

// publishResponse maps publish outcomes; Retry-After rounds the publish budget up to whole seconds.
func publishResponse(c *gin.Context, publish *queue.Service, err error) {
	switch {
	case err == nil:
		c.JSON(http.StatusOK, gin.H{"status": "queued"})
	case errors.Is(err, queue.ErrEnqueueUnavailable), errors.Is(err, queue.ErrDeadlineExceeded):
		c.Header("Retry-After", strconv.Itoa(int(math.Ceil(publish.Budget().Seconds()))))
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "queue unavailable", "retryable": true})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": "unexpected error"})
	}
}
