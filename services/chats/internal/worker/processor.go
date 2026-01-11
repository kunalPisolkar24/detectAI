package worker

import (
	"context"
	"encoding/json"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/core/domain"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/core/ports"
	"github.com/kunalPisolkar24/detectAI/services/chats/pkg/logger"
	"github.com/kunalPisolkar24/detectAI/services/chats/pkg/metrics"
	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"
)

type Processor struct {
	repo      ports.ChatPersistenceRepository
	batchSize int
}

func NewProcessor(repo ports.ChatPersistenceRepository, batchSize int) *Processor {
	return &Processor{
		repo:      repo,
		batchSize: batchSize,
	}
}

func (p *Processor) ProcessBatch(ctx context.Context, streams []redis.XStream, client *redis.ClusterClient, group string) {
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
				logger.Log.Error("Failed to unmarshal message", zap.Error(err))
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
		logger.Log.Error("Bulk upsert failed, messages will retry", zap.Error(err))
		return
	}

	metrics.MessagesIngested.Add(float64(len(messages)))

	pipe := client.Pipeline()
	for stream, ids := range msgIDs {
		pipe.XAck(ctx, stream, group, ids...)
	}
	_, err := pipe.Exec(ctx)
	if err != nil {
		logger.Log.Error("Failed to ack messages", zap.Error(err))
	}
}