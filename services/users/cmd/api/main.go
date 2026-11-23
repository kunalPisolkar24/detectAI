package main

import (
	"log"
	"net/http"
	"strconv"

	"github.com/kunalPisolkar24/detectAI/services/users/internal/config"
	"github.com/kunalPisolkar24/detectAI/services/users/internal/router"
	"github.com/kunalPisolkar24/detectAI/services/users/internal/server"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatal(err)
	}

	protocols := new(http.Protocols)
	protocols.SetHTTP1(true)

	srv := &http.Server{
		Addr:      ":" + strconv.Itoa(cfg.Port),
		Handler:   router.New(),
		Protocols: protocols,
	}

	if err := server.Run(srv, cfg.DrainTimeout); err != nil {
		log.Fatalf("server exited: %v", err)
	}
}
