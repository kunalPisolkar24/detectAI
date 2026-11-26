package main

import (
	"context"
	"log"
	"log/slog"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/cache/coalescer"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/cache/lock"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/cache/setup"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/config"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/db"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/handlers"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/observability"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/repository"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/router"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/server"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/services"
)

const (
	bootBudget           = 10 * time.Second
	connectRetryInterval = 500 * time.Millisecond
	disconnectBudget     = 5 * time.Second
	telemetryBudget      = 15 * time.Second
)

func main() {
	flick, err := config.DeploymentFlick()
	if err != nil {
		log.Fatal(err)
	}
	cfg, err := config.Load()
	if err != nil {
		log.Fatal(err)
	}
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	obs, err := observability.Boot(observability.Config{
		Endpoint:       cfg.OTelEndpoint,
		LicenseKey:     cfg.NewRelicKey,
		ServiceName:    cfg.OTelName,
		ServiceVersion: cfg.OTelVersion,
		SampleRatio:    cfg.OTelSampleRatio,
	}, flick)
	if err != nil {
		log.Fatal(err)
	}

	bootCtx, cancelBoot := context.WithTimeout(context.Background(), bootBudget)
	defer cancelBoot()
	dbClient, err := db.ConnectWithRetry(bootCtx, cfg.MongoURI, cfg.MongoDatabase, connectRetryInterval)
	if err != nil {
		log.Fatal(err)
	}
	repo, err := repository.New(bootCtx, dbClient.Database(), obs)
	if err != nil {
		log.Fatal(err)
	}
	plane, disconnectCache := setup.New(bootCtx, cfg.RedisEndpoint)

	service := services.NewChatService(
		repo,
		plane.Entries,
		plane.Locker,
		coalescer.NewFlightGroup(),
		lock.NewPolicy(cfg.LockTTL),
		slog.Default(),
		obs,
	)
	limits := handlers.Limits{
		Read:   cfg.RateLimitReadMax,
		Create: cfg.RateLimitCreateMax,
		Write:  cfg.RateLimitWriteMax,
	}

	protocols := new(http.Protocols)
	protocols.SetHTTP1(true)
	protocols.SetUnencryptedHTTP2(true)

	srv := &http.Server{
		Addr:      ":" + strconv.Itoa(cfg.Port),
		Handler:   router.New(dbClient, service, cfg.APIKey, plane.Limiter, limits, slog.Default(), obs),
		Protocols: protocols,
	}

	runErr := server.Run(srv, cfg.DrainTimeout)

	telemetryCtx, cancelTelemetry := context.WithTimeout(context.Background(), telemetryBudget)
	if err := obs.Shutdown(telemetryCtx); err != nil {
		log.Printf("observability drain incomplete: %v", err)
	}
	cancelTelemetry()

	drainCtx, cancelDrain := context.WithTimeout(context.Background(), disconnectBudget)
	defer cancelDrain()
	if err := dbClient.Disconnect(drainCtx); err != nil {
		log.Printf("mongo disconnect: %v", err)
	}
	if err := disconnectCache(drainCtx); err != nil {
		log.Printf("redis disconnect: %v", err)
	}

	if runErr != nil {
		log.Fatalf("server exited: %v", runErr)
	}
}
