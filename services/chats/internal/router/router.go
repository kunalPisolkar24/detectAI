// Package router wires the route surface onto the gin engine.
package router

import (
	"log/slog"
	"time"

	connectrpc "connectrpc.com/connect"
	"connectrpc.com/grpchealth"
	"connectrpc.com/grpcreflect"
	"github.com/gin-gonic/gin"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/cache"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/db"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/handlers"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/observability"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/services"
	chatv1connect "github.com/kunalPisolkar24/detectAI/services/chats/proto/chatv1connect"
)

// The RPC budget sits above the driver's five-second server-selection timeout
// so an unreachable source answers UNAVAILABLE before the deadline fires.
const rpcTimeout = 8 * time.Second

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

	reflector := grpcreflect.NewStaticReflector(chatv1connect.ChatServiceName)
	reflectPath, reflectHandler := grpcreflect.NewHandlerV1(reflector)
	r.Any(reflectPath+"*any", gin.WrapH(reflectHandler))
	reflectPathAlpha, reflectHandlerAlpha := grpcreflect.NewHandlerV1Alpha(reflector)
	r.Any(reflectPathAlpha+"*any", gin.WrapH(reflectHandlerAlpha))

	chatPath, chatHandler := chatv1connect.NewChatServiceHandler(
		handlers.New(service),
		connectrpc.WithInterceptors(
			handlers.NewTelemetryInterceptor(obs),
			handlers.NewTimeoutInterceptor(rpcTimeout),
			handlers.NewAuthInterceptor(apiKey),
			handlers.NewRateLimitInterceptor(limiter, limits, logger, obs),
		),
	)
	r.Any(chatPath+"*any", gin.WrapH(chatHandler))

	return r
}
