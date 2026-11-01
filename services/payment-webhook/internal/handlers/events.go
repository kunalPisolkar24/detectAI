package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// InternalEvent accepts an event from apps/web; static until the publisher build lands.
func InternalEvent(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"status": "queued"})
}
