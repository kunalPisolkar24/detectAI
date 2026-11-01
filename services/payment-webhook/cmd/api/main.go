package main

import (
	"log"
	"net/http"
	"os"

	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/router"
	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/server"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	srv := &http.Server{
		Addr:    ":" + port,
		Handler: router.New(),
	}

	if err := server.Run(srv); err != nil {
		log.Fatalf("server exited: %v", err)
	}
}
