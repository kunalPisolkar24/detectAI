package router

import (
	"crypto/sha256"
	"crypto/subtle"
	"net/http"

	"github.com/gin-gonic/gin"
)

// RequireAPIKey guards the internal face: the x-api-key header must match the
// shared secret. Both sides hash to one fixed digest length before the
// constant-time compare, so missing and invalid reject identically and no
// timing difference leaks the secret. The attempt is never echoed or logged
// (NFR-8), and the response never carries WWW-Authenticate.
func RequireAPIKey(secret string) gin.HandlerFunc {
	secretDigest := sha256.Sum256([]byte(secret))
	return func(c *gin.Context) {
		provided := sha256.Sum256([]byte(c.GetHeader("x-api-key")))
		if subtle.ConstantTimeCompare(provided[:], secretDigest[:]) != 1 {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
			return
		}
		c.Next()
	}
}
