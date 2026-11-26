package main

import (
	"context"
	"crypto/ed25519"
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/kunalPisolkar24/detectAI/services/users/internal/cache"
	"github.com/kunalPisolkar24/detectAI/services/users/internal/config"
	"github.com/kunalPisolkar24/detectAI/services/users/internal/db"
	"github.com/kunalPisolkar24/detectAI/services/users/internal/db/sqlc"
	"github.com/kunalPisolkar24/detectAI/services/users/internal/handlers"
	"github.com/kunalPisolkar24/detectAI/services/users/internal/password"
	"github.com/kunalPisolkar24/detectAI/services/users/internal/repository"
	"github.com/kunalPisolkar24/detectAI/services/users/internal/router"
	"github.com/kunalPisolkar24/detectAI/services/users/internal/server"
	"github.com/kunalPisolkar24/detectAI/services/users/internal/services"
	"github.com/kunalPisolkar24/detectAI/services/users/internal/token"
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
	plane, disconnectCache := cache.Setup(bootCtx, cfg.RedisEndpoint)

	accessIssuer, err := token.NewAccessIssuer(cfg.TokenPrivateKey, cfg.AccessTokenTTL)
	if err != nil {
		log.Fatal(err)
	}
	publicKey, ok := cfg.TokenPrivateKey.Public().(ed25519.PublicKey)
	if !ok {
		log.Fatal("config: token signing key is not Ed25519")
	}
	accessVerifier, err := token.NewAccessVerifier(publicKey)
	if err != nil {
		log.Fatal(err)
	}
	refreshTokens, err := token.NewRefreshTokens(cfg.RefreshTokenTTL)
	if err != nil {
		log.Fatal(err)
	}

	repo := repository.New(sqlc.New(dbClient.Pool()))
	cachedUsers := services.NewCachedUsers(
		repo, plane.Store, plane.Locker, cache.NewPolicy(cfg.LockTTL), cfg.QueryTimeout, cache.NewFlightGroup(),
	)
	authService := services.NewAuthService(
		cachedUsers, repo, password.New(), accessIssuer, refreshTokens, cfg.AccessTokenTTL,
	)
	userService := services.NewUserService(cachedUsers, repo, refreshTokens, cachedUsers)

	protocols := new(http.Protocols)
	protocols.SetHTTP1(true)

	limits := handlers.Limits{Read: cfg.RateLimitReadMax, Write: cfg.RateLimitWriteMax}
	srv := &http.Server{
		Addr:      ":" + strconv.Itoa(cfg.Port),
		Handler:   router.New(dbClient, handlers.NewAuth(authService), handlers.NewUser(userService, accessVerifier, cachedUsers), plane.Limiter, limits),
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
