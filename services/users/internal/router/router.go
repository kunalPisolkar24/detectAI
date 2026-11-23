// Package router wires the route surface onto the gin engine.
package router

import "github.com/gin-gonic/gin"

func New() *gin.Engine {
	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.Use(gin.Logger(), gin.Recovery())

	v1 := r.Group("/api/v1")
	v1.GET("/health", Health)
	v1.GET("/ready", Ready)

	return r
}
