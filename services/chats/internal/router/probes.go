package router

import (
	"context"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

// Health is the liveness probe.
func Health(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

// Ready reports readiness; the database must answer a ping within the probe budget.
func Ready(database Database) gin.HandlerFunc {
	return func(c *gin.Context) {
		ctx, cancel := context.WithTimeout(c.Request.Context(), readyPingBudget)
		defer cancel()
		if err := database.Ping(ctx); err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"status": "database unreachable"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"status": "ready"})
	}
}

const readyPingBudget = 2 * time.Second
