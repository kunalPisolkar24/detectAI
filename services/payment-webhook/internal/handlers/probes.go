// Package handlers holds the route handlers.
package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// Health is the liveness probe.
func Health(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

// Ready is the readiness signal.
func Ready(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"status": "ready"})
}
