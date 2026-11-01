package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// PaddleWebhook accepts a Paddle event; static until the validator and publisher builds land.
func PaddleWebhook(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"status": "queued"})
}
