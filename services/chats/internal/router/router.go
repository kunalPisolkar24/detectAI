// Package router wires the route surface onto the gin engine.
package router

import (
	"connectrpc.com/grpchealth"
	"github.com/gin-gonic/gin"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/adapters/connect"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/handlers"
	chatv1connect "github.com/kunalPisolkar24/detectAI/services/chats/proto/chatv1connect"
)

// New builds the engine with the probe routes, the connect health surface, and the ChatService wire.
func New() *gin.Engine {
	gin.SetMode(gin.ReleaseMode)
	r := gin.Default()

	v1 := r.Group("/api/v1")
	v1.GET("/health", handlers.Health)
	v1.GET("/ready", handlers.Ready)

	healthPath, healthHandler := grpchealth.NewHandler(grpchealth.NewStaticChecker("chats.v1.ChatService"))
	r.Any(healthPath+"*any", gin.WrapH(healthHandler))

	chatPath, chatHandler := chatv1connect.NewChatServiceHandler(connect.New())
	r.Any(chatPath+"*any", gin.WrapH(chatHandler))

	return r
}
