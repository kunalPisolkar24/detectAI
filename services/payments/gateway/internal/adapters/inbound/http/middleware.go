package http

import (
	"crypto/subtle"
	"net/http"

	"github.com/gin-gonic/gin"
)

func RequireInternalKey(expected string, recorder interface{ RecordInternalEventUnauthorized() }) gin.HandlerFunc {
	return func(c *gin.Context) {
		key := c.GetHeader("X-Internal-Key")
		if key == "" || subtle.ConstantTimeCompare([]byte(key), []byte(expected)) != 1 {
			if recorder != nil {
				recorder.RecordInternalEventUnauthorized()
			}
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
			return
		}
		c.Next()
	}
}
