package worker

import (
	"context"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/config"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/core/domain"
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
		batch = domain.DefaultPageSize
	}
	return &Consumer{
		client:    client,
		repo:      repo,
		cfg:       cfg,
		processor: NewProcessor(repo, logger, metrics),
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

	partitions := c.cfg.StreamPartitionCount
	if partitions <= 0 {
		partitions = 1
	}

	for i := 0; i < partitions; i++ {
		wg.Add(1)
		go func(partitionID int) {
			defer wg.Done()
			c.runWorker(ctx, partitionID, hostname, &wg)
		}(i)
	}

	wg.Add(1)
	go func() {
		defer wg.Done()
		c.runRecovery(ctx, hostname)
	}()

	wg.Wait()
}

func (c *Consumer) runWorker(ctx context.Context, partitionID int, consumerName string, wg *sync.WaitGroup) {
	group := "chat_persistence_group"
	consumer := fmt.Sprintf("%s-p%d-%d", consumerName, partitionID, time.Now().UnixNano()%10000)
	stream := fmt.Sprintf("global:ingest:{%d}", partitionID)

	ensureGroup := func() error {
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

	wg.Add(1)
	go func() {
		defer wg.Done()
		c.lagReporter(ctx, stream, group)
	}()

	streams := []string{stream, ">"}
	batchSize := int64(c.cfg.BatchSize)
	if batchSize <= 0 {
		batchSize = int64(domain.DefaultPageSize)
	}

	for {
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
			Block:    domain.ReadBlockDuration,
		}).Result()

		if err != nil {
			if err == redis.Nil {
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
	ticker := time.NewTicker(domain.LagReportInterval)
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
	ticker := time.NewTicker(domain.RecoveryInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			partitions := c.cfg.StreamPartitionCount
			if partitions <= 0 {
				partitions = 1
			}
			for i := 0; i < partitions; i++ {
				if ctx.Err() != nil {
					return
				}
				stream := fmt.Sprintf("global:ingest:{%d}", i)
				recoverConsumer := fmt.Sprintf("%s-recover-%d", consumerName, i)

				start := "0-0"
				for {
					if ctx.Err() != nil {
						return
					}
					result, nextCursor, err := c.client.XAutoClaim(ctx, &redis.XAutoClaimArgs{
						Stream:   stream,
						Group:    group,
						Consumer: recoverConsumer,
						MinIdle:  domain.RecoveryIdle,
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
