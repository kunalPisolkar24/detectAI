// Package router wires the route surface onto the gin engine.
package router

import (
	"github.com/gin-gonic/gin"

	"github.com/kunalPisolkar24/detectAI/services/users/internal/db"
	usersv1connect "github.com/kunalPisolkar24/detectAI/services/users/proto/usersv1connect"
)

func New(database db.Database, auth usersv1connect.AuthServiceHandler, user usersv1connect.UserServiceHandler) *gin.Engine {
	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.Use(gin.Logger(), gin.Recovery())

	v1 := r.Group("/api/v1")
	v1.GET("/health", Health)
	v1.GET("/ready", Ready(database))

	authPath, authHandler := usersv1connect.NewAuthServiceHandler(auth)
	r.Any(authPath+"*any", gin.WrapH(authHandler))

	userPath, userHandler := usersv1connect.NewUserServiceHandler(user)
	r.Any(userPath+"*any", gin.WrapH(userHandler))

	return r
}
