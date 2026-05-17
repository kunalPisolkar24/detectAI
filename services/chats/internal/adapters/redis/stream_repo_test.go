//go:build integration

package redis_test

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/google/uuid"
	redisrepo "github.com/kunalPisolkar24/detectAI/services/chats/internal/adapters/redis"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/core/domain"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/testutil"
	goredis "github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestStreamRepository_Publish_MessageArrivesInStream(t *testing.T) {
	fix := testutil.NewRedisFixture(t)
	repo := redisrepo.NewStreamRepository(fix.Client, 1)
	ctx := context.Background()

	msg := &domain.Message{
		ID:        uuid.New().String(),
		ChatID:    "chat-stream-test",
		UserID:    "user-1",
		Content:   "stream test content",
		CreatedAt: time.Now().UTC(),
	}

	require.NoError(t, repo.Publish(ctx, msg))

	streams, err := fix.Client.XRead(ctx, &goredis.XReadArgs{
		Streams: []string{"global:ingest:{0}", "0"},
		Count:   10,
		Block:   time.Second,
	}).Result()
	require.NoError(t, err)
	require.Len(t, streams, 1)
	require.Len(t, streams[0].Messages, 1)

	rawData, ok := streams[0].Messages[0].Values["data"].(string)
	require.True(t, ok)

	var decoded domain.Message
	require.NoError(t, json.Unmarshal([]byte(rawData), &decoded))
	assert.Equal(t, msg.ID, decoded.ID)
	assert.Equal(t, msg.Content, decoded.Content)
}

func TestStreamRepository_Publish_PartitionRouting(t *testing.T) {
	fix := testutil.NewRedisFixture(t)
	repo := redisrepo.NewStreamRepository(fix.Client, 4)
	ctx := context.Background()

	// Publish 20 messages across different chat IDs to verify partitioning
	for i := 0; i < 20; i++ {
		msg := &domain.Message{
			ID:        uuid.New().String(),
			ChatID:    uuid.New().String(),
			UserID:    "user-1",
			Content:   "test",
			CreatedAt: time.Now().UTC(),
		}
		require.NoError(t, repo.Publish(ctx, msg))
	}

	var totalMessages int
	for i := 0; i < 4; i++ {
		streamKey := "global:ingest:{" + string(rune('0'+i)) + "}"
		count, err := fix.Client.XLen(ctx, streamKey).Result()
		if err == nil {
			totalMessages += int(count)
		}
	}
	assert.Equal(t, 20, totalMessages, "all published messages should be distributed across partitions")
}
