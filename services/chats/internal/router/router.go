// Package router wires the route surface onto the gin engine.
package router

import (
	"connectrpc.com/grpchealth"
	"github.com/gin-gonic/gin"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/handlers"
)

// New builds the engine with the probe routes and the connect health surface.
func New() *gin.Engine {
	gin.SetMode(gin.ReleaseMode)
	r := gin.Default()

	v1 := r.Group("/api/v1")
	v1.GET("/health", handlers.Health)
	v1.GET("/ready", handlers.Ready)

	path, healthHandler := grpchealth.NewHandler(grpchealth.NewStaticChecker())
	r.Any(path+"*any", gin.WrapH(healthHandler))

	return r
}
