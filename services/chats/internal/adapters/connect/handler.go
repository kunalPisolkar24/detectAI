// Package connect implements the ChatService wire handler for the router.
package connect

import "github.com/kunalPisolkar24/detectAI/services/chats/proto/chatv1connect"

// Handler serves the ChatService surface; method bodies land with the core
// service, so every RPC answers CodeUnimplemented.
type Handler struct {
	chatv1connect.UnimplementedChatServiceHandler
}

// New builds the ChatService handler.
func New() *Handler {
	return &Handler{}
}
