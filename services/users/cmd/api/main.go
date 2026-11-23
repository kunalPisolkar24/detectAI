package main

import (
	"log"
	"net/http"
	"os"
	"time"

	"github.com/kunalPisolkar24/detectAI/services/users/internal/router"
	"github.com/kunalPisolkar24/detectAI/services/users/internal/server"
)

const (
	defaultPort  = "8090"
	drainTimeout = 5 * time.Second
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = defaultPort
	}

	protocols := new(http.Protocols)
	protocols.SetHTTP1(true)

	srv := &http.Server{
		Addr:      ":" + port,
		Handler:   router.New(),
		Protocols: protocols,
	}

	if err := server.Run(srv, drainTimeout); err != nil {
		log.Fatalf("server exited: %v", err)
	}
}
