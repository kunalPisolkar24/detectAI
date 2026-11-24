package main

import (
	"context"
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/kunalPisolkar24/detectAI/services/users/internal/cache"
	"github.com/kunalPisolkar24/detectAI/services/users/internal/config"
	"github.com/kunalPisolkar24/detectAI/services/users/internal/db"
	"github.com/kunalPisolkar24/detectAI/services/users/internal/router"
	"github.com/kunalPisolkar24/detectAI/services/users/internal/server"
)

const (
	bootBudget           = 10 * time.Second
	connectRetryInterval = 500 * time.Millisecond
	disconnectBudget     = 5 * time.Second
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatal(err)
	}

	bootCtx, cancelBoot := context.WithTimeout(context.Background(), bootBudget)
	defer cancelBoot()
	dbClient, err := db.ConnectWithRetry(bootCtx, cfg.DatabaseURL, connectRetryInterval)
	if err != nil {
		log.Fatal(err)
	}
	_, disconnectCache := cache.Setup(bootCtx, cfg.RedisEndpoint)

	protocols := new(http.Protocols)
	protocols.SetHTTP1(true)

	srv := &http.Server{
		Addr:      ":" + strconv.Itoa(cfg.Port),
		Handler:   router.New(dbClient),
		Protocols: protocols,
	}

	runErr := server.Run(srv, cfg.DrainTimeout)

	drainCtx, cancelDrain := context.WithTimeout(context.Background(), disconnectBudget)
	defer cancelDrain()
	if err := dbClient.Disconnect(drainCtx); err != nil {
		log.Printf("postgres disconnect: %v", err)
	}
	if err := disconnectCache(drainCtx); err != nil {
		log.Printf("redis disconnect: %v", err)
	}

	if runErr != nil {
		log.Fatalf("server exited: %v", runErr)
	}
}
