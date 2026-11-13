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
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/observability"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/services"
	chatv1connect "github.com/kunalPisolkar24/detectAI/services/chats/proto/chatv1connect"
)

func New(database db.Database, service services.Service, apiKey string, limiter cache.Limiter, limits handlers.Limits, logger *slog.Logger, obs observability.Telemetry) *gin.Engine {
	gin.SetMode(gin.ReleaseMode)
	// The trace middleware is registered first so its span brackets the
	// recovery: a panic the recovery absorbs would otherwise leave the span
	// open and the crash untraced.
	r := gin.New()
	observability.Wire(obs, r)
	r.Use(gin.Logger(), gin.Recovery())

	v1 := r.Group("/api/v1")
	v1.GET("/health", Health)
	v1.GET("/ready", Ready(database))

	healthPath, healthHandler := grpchealth.NewHandler(grpchealth.NewStaticChecker("chats.v1.ChatService"))
	r.Any(healthPath+"*any", gin.WrapH(healthHandler))

	chatPath, chatHandler := chatv1connect.NewChatServiceHandler(
		handlers.New(service),
		connectrpc.WithInterceptors(
			handlers.NewTelemetryInterceptor(obs),
			handlers.NewAuthInterceptor(apiKey),
			handlers.NewRateLimitInterceptor(limiter, limits, logger, obs),
		),
	)
	r.Any(chatPath+"*any", gin.WrapH(chatHandler))

	return r
}
