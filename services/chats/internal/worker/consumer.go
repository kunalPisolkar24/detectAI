package worker

import (
	"context"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/config"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/core/ports"
	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"
)

type Consumer struct {
	client    redis.UniversalClient
	repo      ports.ChatPersistenceRepository
	cfg       *config.Config
	processor *Processor
	logger    *zap.Logger
	metrics   ports.MetricsCollector
}

func NewConsumer(
	client redis.UniversalClient,
	repo ports.ChatPersistenceRepository,
	cfg *config.Config,
	logger *zap.Logger,
	metrics ports.MetricsCollector,
) *Consumer {
	return &Consumer{
		client:    client,
		repo:      repo,
		cfg:       cfg,
		processor: NewProcessor(repo, cfg.BatchSize, logger, metrics),
		logger:    logger,
		metrics:   metrics,
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

	ensureGroup := func() error {
		err := c.client.XGroupCreateMkStream(ctx, stream, group, "$").Err()
		if err != nil && err.Error() != "BUSYGROUP Consumer Group name already exists" {
			return err
		}
		return nil
	}

	for {
		if err := ensureGroup(); err != nil {
			c.logger.Error("Failed to create XGroup, retrying...", zap.String("stream", stream), zap.Error(err))
			select {
			case <-ctx.Done():
				return
			case <-time.After(2 * time.Second):
				continue
			}
		}
		break
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
					c.logger.Error("XReadGroup failed", zap.String("stream", stream), zap.Error(err))	
					c.metrics.IncStreamErrors("read")
					if strings.HasPrefix(err.Error(), "NOGROUP") {
						ensureGroup()
					}
					
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
					if !strings.HasPrefix(err.Error(), "NOGROUP") {
						c.logger.Error("Recovery failed", zap.String("stream", stream), zap.Error(err))
						c.metrics.IncStreamErrors("autoclaim")
					}
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
			c.metrics.SetStreamLag(stream, float64(grp.Lag))
		}
	}
}
