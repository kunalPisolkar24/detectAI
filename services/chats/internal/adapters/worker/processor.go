package worker

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/core/domain"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/core/ports"
	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"
)

type Processor struct {
	repo    ports.ChatPersistenceRepository
	logger  *zap.Logger
	metrics ports.MetricsCollector
}

func NewProcessor(
	repo ports.ChatPersistenceRepository,
	logger *zap.Logger,
	metrics ports.MetricsCollector,
) *Processor {
	return &Processor{
		repo:    repo,
		logger:  logger,
		metrics: metrics,
	}
}

func (p *Processor) ProcessBatch(ctx context.Context, streams []redis.XStream, client *redis.Client, group string) {
	messages := make([]*domain.Message, 0)
	msgIDs := make(map[string][]string)

	for _, stream := range streams {
		for _, xMsg := range stream.Messages {
			dataStr, ok := extractData(xMsg.Values["data"])
			if !ok {
				p.logger.Warn("Message missing data field, acking to unblock stream", zap.String("stream", stream.Stream), zap.String("msg_id", xMsg.ID))
				p.metrics.IncStreamErrors("missing_data")
				msgIDs[stream.Stream] = append(msgIDs[stream.Stream], xMsg.ID)
				continue
			}

			var msg domain.Message
			if err := json.Unmarshal([]byte(dataStr), &msg); err != nil {
				p.logger.Error("Failed to unmarshal message, acking poison pill", zap.Error(err), zap.String("stream", stream.Stream), zap.String("msg_id", xMsg.ID))
				p.metrics.IncStreamErrors("unmarshal")
				msgIDs[stream.Stream] = append(msgIDs[stream.Stream], xMsg.ID)
				continue
			}
			if msg.ID == "" || msg.ChatID == "" {
				p.logger.Warn("Message missing required fields, acking", zap.String("msg_id", xMsg.ID), zap.String("chat_id", msg.ChatID))
				p.metrics.IncStreamErrors("invalid_message")
				msgIDs[stream.Stream] = append(msgIDs[stream.Stream], xMsg.ID)
				continue
			}

			messages = append(messages, &msg)
			msgIDs[stream.Stream] = append(msgIDs[stream.Stream], xMsg.ID)
		}
	}

	if len(messages) == 0 {
		if len(msgIDs) == 0 {
			return
		}
		pipe := client.Pipeline()
		for stream, ids := range msgIDs {
			pipe.XAck(ctx, stream, group, ids...)
		}
		if _, err := pipe.Exec(ctx); err != nil {
			p.logger.Error("Failed to ack poison messages", zap.Error(err))
			p.metrics.IncStreamErrors("ack")
		}
		return
	}

	if err := p.repo.BulkUpsertMessages(ctx, messages); err != nil {
		retried := false
		for attempt := 0; attempt < 3; attempt++ {
			backoff := time.Duration(200*(1<<attempt)) * time.Millisecond
			select {
			case <-ctx.Done():
				return
			case <-time.After(backoff):
			}
			if rErr := p.repo.BulkUpsertMessages(ctx, messages); rErr == nil {
				retried = true
				break
			} else {
				err = rErr
			}
		}
		if !retried {
			p.logger.Error("Bulk upsert failed after retries, moving to DLQ", zap.Error(err), zap.Int("count", len(messages)))
			p.metrics.IncDatabaseErrors("bulk_upsert")
			p.handleFailure(ctx, msgIDs, client, group)
			return
		}
		p.logger.Info("Bulk upsert succeeded after retry", zap.Int("count", len(messages)))
	}

	p.metrics.AddIngestedMessages(float64(len(messages)))

	pipe := client.Pipeline()
	for stream, ids := range msgIDs {
		pipe.XAck(ctx, stream, group, ids...)
	}
	if _, err := pipe.Exec(ctx); err != nil {
		p.logger.Error("Failed to ack messages", zap.Error(err))
		p.metrics.IncStreamErrors("ack")
	}
}

func (p *Processor) handleFailure(ctx context.Context, msgIDs map[string][]string, client *redis.Client, group string) {
	pipe := client.Pipeline()
	for stream, ids := range msgIDs {
		for _, id := range ids {
			pipe.SAdd(ctx, "chat:dlq:messages", id)
		}
		pipe.XAck(ctx, stream, group, ids...)
	}
	pipe.Expire(ctx, "chat:dlq:messages", domain.DLQTTL)
	if _, err := pipe.Exec(ctx); err != nil {
		p.logger.Error("Failed to move messages to DLQ", zap.Error(err))
		p.metrics.IncStreamErrors("dlq_push")
	}

	total := 0
	for _, ids := range msgIDs {
		total += len(ids)
	}
	p.metrics.IncDLQMessages(float64(total))
}

// extractData handles both string and []byte payloads from Redis streams.
func extractData(v interface{}) (string, bool) {
	switch val := v.(type) {
	case string:
		return val, true
	case []byte:
		return string(val), true
	case fmt.Stringer:
		return val.String(), true
	default:
		return "", false
	}
}
