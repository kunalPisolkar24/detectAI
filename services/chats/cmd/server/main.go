package main

import (
	"context"
	"os"
	"os/signal"
	"syscall"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/adapters/primary/grpc"
	mongoRepo "github.com/kunalPisolkar24/detectAI/services/chats/internal/adapters/secondary/repository/mongo"
	redisRepo "github.com/kunalPisolkar24/detectAI/services/chats/internal/adapters/secondary/repository/redis"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/config"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/core/services"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/worker"
	"github.com/kunalPisolkar24/detectAI/services/chats/pkg/database"
	"github.com/kunalPisolkar24/detectAI/services/chats/pkg/logger"
	"github.com/kunalPisolkar24/detectAI/services/chats/pkg/metrics"
	"go.uber.org/zap"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		panic(err)
	}

	logger.Init(cfg.AppEnv)
	metrics.Init()
	metrics.StartMetricsServer(cfg.MetricsPort)

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	mongoClient, err := database.ConnectMongo(ctx, cfg.MongoURI)
	if err != nil {
		logger.Log.Fatal("Failed to connect to Mongo", zap.Error(err))
	}
	defer mongoClient.Disconnect(context.Background())

	redisClient, err := redisRepo.NewClusterClient(cfg)
	if err != nil {
		logger.Log.Fatal("Failed to connect to Redis", zap.Error(err))
	}
	defer redisClient.Close()

	mongoDB := mongoClient.Database(cfg.MongoDatabase)
	persistenceRepo := mongoRepo.NewMongoRepository(mongoDB)
	streamRepo := redisRepo.NewStreamRepository(redisClient, cfg.StreamPartitionCount)
	cacheRepo := redisRepo.NewCacheRepository(redisClient, cfg.CacheTTL)

	if cfg.ServiceRole == "api" {
		svc := services.NewChatService(cacheRepo, streamRepo, persistenceRepo)
		server := grpc.NewServer(cfg, svc)
		if err := server.Run(ctx); err != nil {
			logger.Log.Fatal("Server crashed", zap.Error(err))
		}
	} else if cfg.ServiceRole == "worker" {
		consumer := worker.NewConsumer(redisClient, persistenceRepo, cfg)
		consumer.Start(ctx)
	} else {
		logger.Log.Fatal("Invalid ServiceRole")
	}
}
