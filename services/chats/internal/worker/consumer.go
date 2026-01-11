package worker

import (
	"context"
	"fmt"
	"os"
	"sync"
	"time"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/config"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/core/ports"
	"github.com/kunalPisolkar24/detectAI/services/chats/pkg/logger"
	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"
)

type Consumer struct {
	client    *redis.ClusterClient
	repo      ports.ChatPersistenceRepository
	cfg       *config.Config
	processor *Processor
}

func NewConsumer(
	client *redis.ClusterClient,
	repo ports.ChatPersistenceRepository,
	cfg *config.Config,
) *Consumer {
	return &Consumer{
		client:    client,
		repo:      repo,
		cfg:       cfg,
		processor: NewProcessor(repo, cfg.BatchSize),
	}
}

func (c *Consumer) Start(ctx context.Context) {
	var wg sync.WaitGroup
	hostname, _ := os.Hostname()

	for i := 0; i < c.cfg.WorkerConcurrency; i++ {
		wg.Add(1)
		go func(workerID int) {
			defer wg.Done()
			c.runWorker(ctx, workerID, hostname)
		}(i)
	}

	wg.Wait()
}

func (c *Consumer) runWorker(ctx context.Context, id int, consumerName string) {
	group := "chat_persistence_group"
	consumer := fmt.Sprintf("%s-%d", consumerName, id)

	streams := make([]string, 0, c.cfg.StreamPartitionCount*2)
	for i := 0; i < c.cfg.StreamPartitionCount; i++ {
		stream := fmt.Sprintf("global:ingest:{%d}", i)
		streams = append(streams, stream)

		c.client.XGroupCreateMkStream(ctx, stream, group, "$")
	}

	for i := 0; i < c.cfg.StreamPartitionCount; i++ {
		streams = append(streams, ">")
	}

	for {
		select {
		case <-ctx.Done():
			return
		default:
			result, err := c.client.XReadGroup(ctx, &redis.XReadGroupArgs{
				Group:    group,
				Consumer: consumer,
				Streams:  streams,
				Count:    int64(c.cfg.BatchSize),
				Block:    2 * time.Second,
			}).Result()

			if err != nil && err != redis.Nil {
				logger.Log.Error("XReadGroup failed", zap.Error(err))
				time.Sleep(time.Second)
				continue
			}

			if len(result) > 0 {
				c.processor.ProcessBatch(ctx, result, c.client, group)
			}
		}
	}
}
