package main

import (
	"context"
	"log"
	"log/slog"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/cache"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/config"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/db"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/handlers"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/repository"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/router"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/server"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/services"
)

const (
	bootBudget       = 10 * time.Second
	disconnectBudget = 5 * time.Second
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatal(err)
	}
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))

	bootCtx, cancelBoot := context.WithTimeout(context.Background(), bootBudget)
	defer cancelBoot()
	dbClient, err := db.Connect(bootCtx, cfg.MongoURI, cfg.MongoDatabase)
	if err != nil {
		log.Fatal(err)
	}
	repo, err := repository.New(bootCtx, dbClient.Database())
	if err != nil {
		log.Fatal(err)
	}
	cacheClient, err := cache.Connect(bootCtx, cfg.RedisEndpoint, cfg.RedisAuthToken)
	if err != nil {
		log.Fatal(err)
	}

	service := services.NewChatService(
		repo,
		cache.NewEntries(cacheClient),
		slog.Default(),
	)
	limits := handlers.Limits{
		Create: cfg.RateLimitCreateMax,
		Write:  cfg.RateLimitWriteMax,
	}

	protocols := new(http.Protocols)
	protocols.SetHTTP1(true)
	protocols.SetUnencryptedHTTP2(true)

	srv := &http.Server{
		Addr:      ":" + strconv.Itoa(cfg.Port),
		Handler:   router.New(dbClient, service, cfg.APIKey, cache.NewLimiter(cacheClient), limits, slog.Default()),
		Protocols: protocols,
	}

	runErr := server.Run(srv, cfg.DrainTimeout)

	drainCtx, cancelDrain := context.WithTimeout(context.Background(), disconnectBudget)
	defer cancelDrain()
	if err := dbClient.Disconnect(drainCtx); err != nil {
		log.Printf("mongo disconnect: %v", err)
	}
	if err := cacheClient.Disconnect(drainCtx); err != nil {
		log.Printf("redis disconnect: %v", err)
	}

	if runErr != nil {
		log.Fatalf("server exited: %v", runErr)
	}
}
