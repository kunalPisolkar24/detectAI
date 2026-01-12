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
	"github.com/kunalPisolkar24/detectAI/services/chats/pkg/metrics"
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

	for i := 0; i < c.cfg.StreamPartitionCount; i++ {
		wg.Add(1)
		go func(partitionID int) {
			defer wg.Done()
			c.runWorker(ctx, partitionID, hostname)
		}(i)
	}

	wg.Add(1)
	go func() {
		defer wg.Done()
		c.runRecovery(ctx, hostname)
	}()

	wg.Wait()
}

func (c *Consumer) runWorker(ctx context.Context, partitionID int, consumerName string) {
	group := "chat_persistence_group"
	consumer := fmt.Sprintf("%s-p%d", consumerName, partitionID)
	stream := fmt.Sprintf("global:ingest:{%d}", partitionID)

	err := c.client.XGroupCreateMkStream(ctx, stream, group, "$").Err()
	if err != nil && err.Error() != "BUSYGROUP Consumer Group name already exists" {
		logger.Log.Error("Failed to create XGroup", zap.String("stream", stream), zap.Error(err))
	}

	streams := []string{stream, ">"}

	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			c.updateSingleLag(ctx, stream, group)
		default:
			result, err := c.client.XReadGroup(ctx, &redis.XReadGroupArgs{
				Group:    group,
				Consumer: consumer,
				Streams:  streams,
				Count:    int64(c.cfg.BatchSize),
				Block:    2 * time.Second,
			}).Result()

			if err != nil {
				if err != redis.Nil {
					logger.Log.Error("XReadGroup failed", zap.String("stream", stream), zap.Error(err))
					time.Sleep(time.Second)
				}
				continue
			}

			if len(result) > 0 {
				c.processor.ProcessBatch(ctx, result, c.client, group)
			}
		}
	}
}

func (c *Consumer) runRecovery(ctx context.Context, consumerName string) {
	group := "chat_persistence_group"
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			for i := 0; i < c.cfg.StreamPartitionCount; i++ {
				stream := fmt.Sprintf("global:ingest:{%d}", i)
				
				result, _, err := c.client.XAutoClaim(ctx, &redis.XAutoClaimArgs{
					Stream:   stream,
					Group:    group,
					Consumer: fmt.Sprintf("%s-recover", consumerName),
					MinIdle:  60 * time.Second,
					Count:    10,
					Start:    "0-0",
				}).Result()

				if err != nil && err != redis.Nil {
					logger.Log.Error("Recovery failed", zap.String("stream", stream), zap.Error(err))
					continue
				}

				if len(result) > 0 {
					streams := []redis.XStream{{
						Stream:   stream,
						Messages: result,
					}}
					c.processor.ProcessBatch(ctx, streams, c.client, group)
				}
			}
		}
	}
}

func (c *Consumer) updateSingleLag(ctx context.Context, stream, group string) {
	info, err := c.client.XInfoGroups(ctx, stream).Result()
	if err != nil {
		return
	}
	for _, grp := range info {
		if grp.Name == group {
			metrics.StreamLag.WithLabelValues(stream).Set(float64(grp.Lag))
		}
	}
}