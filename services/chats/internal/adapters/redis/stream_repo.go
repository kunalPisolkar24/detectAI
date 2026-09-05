package redis

import (
	"context"
	"encoding/json"
	"fmt"
	"hash/crc32"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/core/domain"
	"github.com/redis/go-redis/v9"
)

type StreamRepository struct {
	client     redis.UniversalClient
	partitions int
}

func NewStreamRepository(client redis.UniversalClient, partitions int) *StreamRepository {
	if partitions <= 0 {
		partitions = 1
	}
	if partitions > 128 {
		partitions = 128
	}
	return &StreamRepository{
		client:     client,
		partitions: partitions,
	}
}

func (r *StreamRepository) Publish(ctx context.Context, msg *domain.Message) error {
	if msg == nil {
		return fmt.Errorf("nil message")
	}
	if msg.ChatID == "" {
		return fmt.Errorf("chat_id is required")
	}
	data, err := json.Marshal(msg)
	if err != nil {
		return err
	}

	partition := crc32.ChecksumIEEE([]byte(msg.ChatID)) % uint32(r.partitions)
	streamKey := fmt.Sprintf("global:ingest:{%d}", partition)

	return r.client.XAdd(ctx, &redis.XAddArgs{
		Stream: streamKey,
		MaxLen: 100000,
		Approx: true,
		Values: map[string]interface{}{
			"data": data,
		},
	}).Err()
}
