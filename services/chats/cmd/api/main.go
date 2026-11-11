package main

import (
	"log"
	"net/http"
	"time"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/router"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/server"
)

func main() {
	protocols := new(http.Protocols)
	protocols.SetHTTP1(true)
	protocols.SetUnencryptedHTTP2(true)

	srv := &http.Server{
		Addr:      ":8090",
		Handler:   router.New(),
		Protocols: protocols,
	}

	if err := server.Run(srv, 10*time.Second); err != nil {
		log.Fatalf("server exited: %v", err)
	}
}
