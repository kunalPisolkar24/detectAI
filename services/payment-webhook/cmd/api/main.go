package main

import (
	"log"
	"net/http"
	"strconv"

	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/config"
	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/router"
	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/server"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatal(err)
	}

	srv := &http.Server{
		Addr:    ":" + strconv.Itoa(cfg.Port),
		Handler: router.New(),
	}

	if err := server.Run(srv, cfg.DrainTimeout); err != nil {
		log.Fatalf("server exited: %v", err)
	}
}
