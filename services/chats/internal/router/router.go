// Package router wires the route surface onto the gin engine.
package router

import (
	connectrpc "connectrpc.com/connect"
	"connectrpc.com/grpchealth"
	"github.com/gin-gonic/gin"

	chatsconnect "github.com/kunalPisolkar24/detectAI/services/chats/internal/adapters/connect"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/core"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/db"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/handlers"
	chatv1connect "github.com/kunalPisolkar24/detectAI/services/chats/proto/chatv1connect"
)

// New builds the engine with the probe routes, the connect health surface, and the ChatService wire.
func New(database db.Database, service core.Service, apiKey string) *gin.Engine {
	gin.SetMode(gin.ReleaseMode)
	r := gin.Default()

	v1 := r.Group("/api/v1")
	v1.GET("/health", handlers.Health)
	v1.GET("/ready", handlers.Ready(database))

	healthPath, healthHandler := grpchealth.NewHandler(grpchealth.NewStaticChecker("chats.v1.ChatService"))
	r.Any(healthPath+"*any", gin.WrapH(healthHandler))

	chatPath, chatHandler := chatv1connect.NewChatServiceHandler(
		chatsconnect.New(service),
		connectrpc.WithInterceptors(chatsconnect.NewAuthInterceptor(apiKey)),
	)
	r.Any(chatPath+"*any", gin.WrapH(chatHandler))

	return r
}
