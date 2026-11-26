// Package router wires the route surface onto the gin engine.
package router

import (
	"log/slog"

	connectrpc "connectrpc.com/connect"
	"github.com/gin-gonic/gin"

	"github.com/kunalPisolkar24/detectAI/services/users/internal/cache/limiter"
	"github.com/kunalPisolkar24/detectAI/services/users/internal/db"
	"github.com/kunalPisolkar24/detectAI/services/users/internal/handlers"
	"github.com/kunalPisolkar24/detectAI/services/users/internal/token"
	usersv1connect "github.com/kunalPisolkar24/detectAI/services/users/proto/usersv1connect"
)

func New(database db.Database, auth usersv1connect.AuthServiceHandler, user usersv1connect.UserServiceHandler, verifier token.AccessVerifier, lookup handlers.UserLookup, rateLimiter limiter.Limiter, limits handlers.Limits) *gin.Engine {
	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.Use(gin.Logger(), gin.Recovery())

	v1 := r.Group("/api/v1")
	v1.GET("/health", Health)
	v1.GET("/ready", Ready(database))

	interceptors := connectrpc.WithInterceptors(
		handlers.NewAuthInterceptor(verifier, lookup),
		handlers.NewRateLimitInterceptor(rateLimiter, limits, slog.Default()),
	)

	authPath, authHandler := usersv1connect.NewAuthServiceHandler(auth, interceptors)
	r.Any(authPath+"*any", gin.WrapH(authHandler))

	userPath, userHandler := usersv1connect.NewUserServiceHandler(user, interceptors)
	r.Any(userPath+"*any", gin.WrapH(userHandler))

	return r
}
