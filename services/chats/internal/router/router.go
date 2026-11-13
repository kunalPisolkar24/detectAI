// Package router wires the route surface onto the gin engine.
package router

import (
	"log/slog"

	connectrpc "connectrpc.com/connect"
	"connectrpc.com/grpchealth"
	"github.com/gin-gonic/gin"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/cache"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/db"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/handlers"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/services"
	chatv1connect "github.com/kunalPisolkar24/detectAI/services/chats/proto/chatv1connect"
)

// New builds the engine with the probe routes, the connect health surface, and the ChatService wire.
func New(database db.Database, service services.Service, apiKey string, limiter cache.Limiter, limits handlers.Limits, logger *slog.Logger) *gin.Engine {
	gin.SetMode(gin.ReleaseMode)
	r := gin.Default()

	v1 := r.Group("/api/v1")
	v1.GET("/health", Health)
	v1.GET("/ready", Ready(database))

	healthPath, healthHandler := grpchealth.NewHandler(grpchealth.NewStaticChecker("chats.v1.ChatService"))
	r.Any(healthPath+"*any", gin.WrapH(healthHandler))

	chatPath, chatHandler := chatv1connect.NewChatServiceHandler(
		handlers.New(service),
		connectrpc.WithInterceptors(
			handlers.NewAuthInterceptor(apiKey),
			handlers.NewRateLimitInterceptor(limiter, limits, logger),
		),
	)
	r.Any(chatPath+"*any", gin.WrapH(chatHandler))

	return r
}
