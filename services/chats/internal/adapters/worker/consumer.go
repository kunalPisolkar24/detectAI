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
	batch := cfg.BatchSize
	if batch <= 0 {
		batch = 50
	}
	partitions := cfg.StreamPartitionCount
	if partitions <= 0 {
		partitions = 1
	}
	// Ensure cfg reflects normalized values for workers already created.
	cfg.BatchSize = batch
	cfg.StreamPartitionCount = partitions
	return &Consumer{
		client:    client,
		repo:      repo,
		cfg:       cfg,
		processor: NewProcessor(repo, batch, logger, metrics),
		logger:    logger,
		metrics:   metrics,
	}
}

func (c *Consumer) Start(ctx context.Context) {
	var wg sync.WaitGroup
	hostname, err := os.Hostname()
	if err != nil || hostname == "" {
		hostname = fmt.Sprintf("chat-worker-%d", time.Now().UnixNano())
	}

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
	consumer := fmt.Sprintf("%s-p%d-%d", consumerName, partitionID, time.Now().UnixNano()%10000)
	stream := fmt.Sprintf("global:ingest:{%d}", partitionID)

	ensureGroup := func() error {
		// Use "0" so that any messages produced while the worker was down are not lost.
		// If the group already exists, BUSYGROUP is returned and we keep the existing offset.
		err := c.client.XGroupCreateMkStream(ctx, stream, group, "0").Err()
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

	// Lag reporting in background so that blocking XReadGroup doesn't starve it.
	go c.lagReporter(ctx, stream, group)

	streams := []string{stream, ">"}
	batchSize := int64(c.cfg.BatchSize)

	for {
		// Graceful shutdown check before blocking
		select {
		case <-ctx.Done():
			return
		default:
		}

		result, err := c.client.XReadGroup(ctx, &redis.XReadGroupArgs{
			Group:    group,
			Consumer: consumer,
			Streams:  streams,
			Count:    batchSize,
			Block:    2 * time.Second,
		}).Result()

		if err != nil {
			if err == redis.Nil {
				// Timeout with no messages; continue to allow ctx cancellation check.
				continue
			}
			if ctx.Err() != nil {
				return
			}
			c.logger.Error("XReadGroup failed", zap.String("stream", stream), zap.Error(err))
			c.metrics.IncStreamErrors("read")
			if strings.HasPrefix(err.Error(), "NOGROUP") {
				if gErr := ensureGroup(); gErr != nil {
					c.logger.Error("Failed to re-create missing group", zap.Error(gErr))
				}
			}
			// Respect context during backoff
			select {
			case <-ctx.Done():
				return
			case <-time.After(time.Second):
			}
			continue
		}

		if len(result) > 0 && len(result[0].Messages) > 0 {
			c.processor.ProcessBatch(ctx, result, c.client, group)
		}
	}
}

func (c *Consumer) lagReporter(ctx context.Context, stream, group string) {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			c.updateSingleLag(ctx, stream, group)
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
				if ctx.Err() != nil {
					return
				}
				stream := fmt.Sprintf("global:ingest:{%d}", i)
				recoverConsumer := fmt.Sprintf("%s-recover-%d", consumerName, i)

				// Cursor-based loop to drain all pending messages beyond Count limit.
				start := "0-0"
				for {
					if ctx.Err() != nil {
						return
					}
					result, nextCursor, err := c.client.XAutoClaim(ctx, &redis.XAutoClaimArgs{
						Stream:   stream,
						Group:    group,
						Consumer: recoverConsumer,
						MinIdle:  60 * time.Second,
						Count:    50,
						Start:    start,
					}).Result()

					if err != nil && err != redis.Nil {
						if !strings.HasPrefix(err.Error(), "NOGROUP") {
							c.logger.Error("Recovery XAutoClaim failed", zap.String("stream", stream), zap.Error(err))
							c.metrics.IncStreamErrors("autoclaim")
						}
						break
					}

					if len(result) > 0 {
						streams := []redis.XStream{{
							Stream:   stream,
							Messages: result,
						}}
						c.processor.ProcessBatch(ctx, streams, c.client, group)
					}

					// nextCursor "0-0" means we've completed a full iteration
					if nextCursor == "0-0" || len(result) == 0 {
						break
					}
					start = nextCursor
				}
			}
		}
	}
}

func (c *Consumer) updateSingleLag(ctx context.Context, stream, group string) {
	info, err := c.client.XInfoGroups(ctx, stream).Result()
	if err != nil {
		// Stream may not exist yet; not an error to log at error level.
		if err != redis.Nil && !strings.Contains(err.Error(), "no such key") && !strings.Contains(err.Error(), "NOGROUP") {
			c.logger.Warn("Failed to get stream info", zap.String("stream", stream), zap.Error(err))
		}
		return
	}
	for _, grp := range info {
		if grp.Name == group {
			c.metrics.SetStreamLag(stream, float64(grp.Lag))
			return
		}
	}
}
