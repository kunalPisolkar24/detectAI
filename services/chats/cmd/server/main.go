package main

import (
	"context"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/adapters/grpc"
	mongoRepo "github.com/kunalPisolkar24/detectAI/services/chats/internal/adapters/mongo"
	redisRepo "github.com/kunalPisolkar24/detectAI/services/chats/internal/adapters/redis"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/adapters/worker"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/config"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/core/domain"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/core/ports"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/core/usecase"
	"github.com/kunalPisolkar24/detectAI/services/chats/pkg/database"
	"github.com/kunalPisolkar24/detectAI/services/chats/pkg/logger"
	"github.com/kunalPisolkar24/detectAI/services/chats/pkg/metrics"
	"github.com/redis/go-redis/v9"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/readpref"
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

	mongoClient, err := connectMongoWithRetry(ctx, cfg.MongoURI)
	if err != nil {
		logger.Log.Fatal("Failed to connect to Mongo after retries", zap.Error(err))
	}
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = mongoClient.Disconnect(ctx)
	}()

	// Redis is optional: API degrades to sync Mongo, worker retries until available.
	redisClient, redisDegraded := connectRedisDegraded(ctx, cfg)

	mongoDB := mongoClient.Database(cfg.MongoDatabase)
	if err := mongoRepo.EnsureIndexes(ctx, mongoDB); err != nil {
		logger.Log.Error("Failed to ensure mongo indexes", zap.Error(err))
	}

	persistenceRepo := mongoRepo.NewMongoRepository(mongoDB)

	var streamRepo ports.ChatStreamRepository
	var cacheRepo ports.ChatCacheRepository
	if redisDegraded || redisClient == nil {
		logger.Log.Warn("Redis unavailable at boot — running in degraded mode (sync Mongo fallback)")
		streamRepo = &redisRepo.NoopStream{}
		cacheRepo = &redisRepo.NoopCache{}
	} else {
		streamRepo = redisRepo.NewStreamRepository(redisClient, cfg.StreamPartitionCount)
		cacheRepo = redisRepo.NewCacheRepository(redisClient, cfg.CacheTTL)
	}
	// Ensure we close redis only when we own a real client
	if redisClient != nil {
		defer func() { _ = redisClient.Close() }()
	}

	switch cfg.ServiceRole {
	case "api":
		promMetrics := metrics.NewPrometheusMetrics()
		if redisDegraded {
			promMetrics.SetRedisDegraded(1)
		} else {
			promMetrics.SetRedisDegraded(0)
		}
		// If degraded at boot, try to recover Redis in background
		if redisDegraded {
			go recoverRedisLoop(ctx, cfg, &streamRepo, &cacheRepo, promMetrics)
		}
		svc := usecase.NewChatService(cacheRepo, streamRepo, persistenceRepo, logger.Log, promMetrics)
		server := grpc.NewServer(cfg, svc)

		go healthLoop(ctx, mongoClient, redisClient, server, promMetrics)

		if err := server.Run(ctx); err != nil {
			logger.Log.Fatal("Server crashed", zap.Error(err))
		}
	case "worker":
		// Worker requires Redis; if degraded at boot, block until it recovers.
		if redisDegraded {
			logger.Log.Warn("Worker waiting for Redis to become available...")
			rc := waitForRedis(ctx, cfg)
			if rc == nil {
				logger.Log.Fatal("Worker exiting: context canceled while waiting for Redis")
			}
			redisClient = rc
			defer func() { _ = redisClient.Close() }()
			streamRepo = redisRepo.NewStreamRepository(redisClient, cfg.StreamPartitionCount)
			cacheRepo = redisRepo.NewCacheRepository(redisClient, cfg.CacheTTL)
			logger.Log.Info("Worker Redis recovered, starting consumer")
		}
		promMetrics := metrics.NewPrometheusMetrics()
		promMetrics.SetRedisDegraded(0)
		consumer := worker.NewConsumer(redisClient, persistenceRepo, cfg, logger.Log, promMetrics)
		consumer.Start(ctx)
	}
}

func connectMongoWithRetry(ctx context.Context, uri string) (*mongo.Client, error) {
	backoff := time.Second
	var lastErr error
	for attempt := 0; attempt < 12; attempt++ {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		client, err := database.ConnectMongo(ctx, uri)
		if err == nil {
			if attempt > 0 {
				logger.Log.Info("Mongo connected after retries", zap.Int("attempt", attempt+1))
			}
			return client, nil
		}
		lastErr = err
		logger.Log.Warn("Mongo connect failed, retrying", zap.Int("attempt", attempt+1), zap.Duration("backoff", backoff), zap.Error(err))
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(backoff):
		}
		backoff *= 2
		if backoff > 30*time.Second {
			backoff = 30 * time.Second
		}
	}
	return nil, lastErr
}

func connectRedisDegraded(ctx context.Context, cfg *config.Config) (redis.UniversalClient, bool) {
	client, err := redisRepo.NewClient(cfg)
	if err == nil {
		return client, false
	}
	logger.Log.Warn("Redis connect failed at boot", zap.Error(err))
	return nil, true
}

func waitForRedis(ctx context.Context, cfg *config.Config) redis.UniversalClient {
	backoff := time.Second
	for {
		if ctx.Err() != nil {
			return nil
		}
		client, err := redisRepo.NewClient(cfg)
		if err == nil {
			return client
		}
		logger.Log.Warn("Worker Redis still unavailable, retrying", zap.Duration("backoff", backoff), zap.Error(err))
		select {
		case <-ctx.Done():
			return nil
		case <-time.After(backoff):
		}
		backoff *= 2
		if backoff > 30*time.Second {
			backoff = 30 * time.Second
		}
	}
}

func recoverRedisLoop(ctx context.Context, cfg *config.Config, streamRepo *ports.ChatStreamRepository, cacheRepo *ports.ChatCacheRepository, m *metrics.PrometheusMetrics) {
	backoff := 5 * time.Second
	for {
		select {
		case <-ctx.Done():
			return
		case <-time.After(backoff):
		}
		client, err := redisRepo.NewClient(cfg)
		if err != nil {
			logger.Log.Warn("Redis recovery attempt failed", zap.Error(err))
			backoff *= 2
			if backoff > 30*time.Second {
				backoff = 30 * time.Second
			}
			continue
		}
		logger.Log.Info("Redis recovered from degraded mode")
		*streamRepo = redisRepo.NewStreamRepository(client, cfg.StreamPartitionCount)
		*cacheRepo = redisRepo.NewCacheRepository(client, cfg.CacheTTL)
		m.SetRedisDegraded(0)
		return
	}
}

func healthLoop(ctx context.Context, mongoClient *mongo.Client, redisClient redis.UniversalClient, server *grpc.Server, m *metrics.PrometheusMetrics) {
	ticker := time.NewTicker(domain.HealthCheckInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			healthCtx, hCancel := context.WithTimeout(context.Background(), domain.HealthPingTimeout)
			mErr := mongoClient.Ping(healthCtx, readpref.Primary())
			var rErr error
			if redisClient != nil {
				rErr = redisClient.Ping(healthCtx).Err()
			} else {
				rErr = redisRepo.ErrRedisUnavailable
			}
			hCancel()
			// SERVING iff Mongo healthy; Redis state is via gauge.
			healthy := mErr == nil
			server.SetHealth(healthy)
			if redisClient == nil || rErr != nil {
				m.SetRedisDegraded(1)
			} else {
				m.SetRedisDegraded(0)
			}
			if !healthy {
				logger.Log.Warn("Health check failed", zap.Error(mErr), zap.Error(rErr))
			}
		}
	}
}
