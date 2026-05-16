package worker

import (
	"context"
	"encoding/json"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/core/domain"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/core/ports"
	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"
)

type Processor struct {
	repo      ports.ChatPersistenceRepository
	batchSize int
	logger    *zap.Logger
	metrics   ports.MetricsCollector
}

func NewProcessor(
	repo ports.ChatPersistenceRepository,
	batchSize int,
	logger *zap.Logger,
	metrics ports.MetricsCollector,
) *Processor {
	return &Processor{
		repo:      repo,
		batchSize: batchSize,
		logger:    logger,
		metrics:   metrics,
	}
}

func (p *Processor) ProcessBatch(ctx context.Context, streams []redis.XStream, client redis.UniversalClient, group string) {
	messages := make([]*domain.Message, 0)
	msgIDs := make(map[string][]string)

	for _, stream := range streams {
		for _, xMsg := range stream.Messages {
			var msg domain.Message
			dataStr, ok := xMsg.Values["data"].(string)
			if !ok {
				msgIDs[stream.Stream] = append(msgIDs[stream.Stream], xMsg.ID) // Ack bad data
				continue
			}

			if err := json.Unmarshal([]byte(dataStr), &msg); err != nil {
				p.logger.Error("Failed to unmarshal message", zap.Error(err))
				msgIDs[stream.Stream] = append(msgIDs[stream.Stream], xMsg.ID) // Ack corrupted data
				continue
			}

			messages = append(messages, &msg)
			msgIDs[stream.Stream] = append(msgIDs[stream.Stream], xMsg.ID)
		}
	}

	if len(messages) == 0 {
		return
	}

	if err := p.repo.BulkUpsertMessages(ctx, messages); err != nil {
		p.logger.Error("Bulk upsert failed, moving to DLQ", zap.Error(err))
		p.handleFailure(ctx, msgIDs, client, group)
		return
	}

	p.metrics.AddIngestedMessages(float64(len(messages)))

	pipe := client.Pipeline()
	for stream, ids := range msgIDs {
		pipe.XAck(ctx, stream, group, ids...)
	}
	_, err := pipe.Exec(ctx)
	if err != nil {
		p.logger.Error("Failed to ack messages", zap.Error(err))
	}
}

func (p *Processor) handleFailure(ctx context.Context, msgIDs map[string][]string, client redis.UniversalClient, group string) {
	pipe := client.Pipeline()
	for stream, ids := range msgIDs {
		// Store in DLQ for manual inspection
		for _, id := range ids {
			pipe.SAdd(ctx, "chat:dlq:messages", id)
		}
		// ACK so they don't block the stream
		pipe.XAck(ctx, stream, group, ids...)
	}
	if _, err := pipe.Exec(ctx); err != nil {
		p.logger.Error("Failed to move messages to DLQ", zap.Error(err))
	}
}
