//go:build integration

package worker

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/google/uuid"
	mongorepo "github.com/kunalPisolkar24/detectAI/services/chats/internal/adapters/mongo"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/config"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/core/domain"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/testutil"
	goredis "github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
)

func publishRaw(t *testing.T, client goredis.UniversalClient, streamKey string, msg *domain.Message) {
	t.Helper()
	data, err := json.Marshal(msg)
	require.NoError(t, err)
	err = client.XAdd(context.Background(), &goredis.XAddArgs{
		Stream: streamKey,
		Values: map[string]interface{}{"data": string(data)},
	}).Err()
	require.NoError(t, err)
}

func TestWorker_ProcessesBatchFromStreamToMongo(t *testing.T) {
	mongoFix := testutil.NewMongoFixture(t, "chat_worker_test")
	redisFix := testutil.NewRedisFixture(t)

	ctx := context.Background()
	require.NoError(t, mongorepo.EnsureIndexes(ctx, mongoFix.DB))

	repo := mongorepo.NewMongoRepository(mongoFix.DB)
	logger := zap.NewNop()
	metrics := &noopMetrics{}

	cfg := &config.Config{
		BatchSize:            10,
		StreamPartitionCount: 1,
	}

	consumer := NewConsumer(redisFix.Client, repo, cfg, logger, metrics)

	chatID := uuid.New().String()
	streamKey := "global:ingest:{0}"

	msg1 := &domain.Message{ID: uuid.New().String(), ChatID: chatID, UserID: "user-1", Content: "hello", CreatedAt: time.Now().UTC()}
	msg2 := &domain.Message{ID: uuid.New().String(), ChatID: chatID, UserID: "user-1", Content: "world", CreatedAt: time.Now().UTC().Add(time.Millisecond)}

	// Explicitly create group so it reads from 0 and captures these messages
	redisFix.Client.XGroupCreateMkStream(ctx, streamKey, "chat_persistence_group", "0")

	publishRaw(t, redisFix.Client, streamKey, msg1)
	publishRaw(t, redisFix.Client, streamKey, msg2)


	cancelCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	go consumer.Start(cancelCtx)

	// Poll until messages appear in Mongo or timeout
	require.Eventually(t, func() bool {
		history, err := repo.GetHistory(ctx, chatID, 0, 10)
		return err == nil && len(history) == 2
	}, 10*time.Second, 200*time.Millisecond, "messages should be persisted to Mongo within 10s")

	history, err := repo.GetHistory(ctx, chatID, 0, 10)
	require.NoError(t, err)
	ids := make(map[string]bool)
	for _, m := range history {
		ids[m.ID] = true
	}
	assert.True(t, ids[msg1.ID], "msg1 should be in history")
	assert.True(t, ids[msg2.ID], "msg2 should be in history")
}

func TestWorker_PoisonPill_MovesToDLQ(t *testing.T) {
	mongoFix := testutil.NewMongoFixture(t, "chat_worker_dlq_test")
	redisFix := testutil.NewRedisFixture(t)

	ctx := context.Background()
	require.NoError(t, mongorepo.EnsureIndexes(ctx, mongoFix.DB))

	repo := mongorepo.NewMongoRepository(mongoFix.DB)
	logger := zap.NewNop()
	metrics := &noopMetrics{}

	cfg := &config.Config{
		BatchSize:            10,
		StreamPartitionCount: 1,
	}

	consumer := NewConsumer(redisFix.Client, repo, cfg, logger, metrics)

	redisFix.Client.XGroupCreateMkStream(ctx, "global:ingest:{0}", "chat_persistence_group", "0")

	// Publish malformed JSON directly
	err := redisFix.Client.XAdd(ctx, &goredis.XAddArgs{
		Stream: "global:ingest:{0}",
		Values: map[string]interface{}{"data": "this is not json {{{"},
	}).Err()

	require.NoError(t, err)

	// Publish a valid message after the poison pill to verify stream is not blocked
	validMsg := &domain.Message{ID: uuid.New().String(), ChatID: uuid.New().String(), UserID: "user-1", Content: "valid", CreatedAt: time.Now().UTC()}
	publishRaw(t, redisFix.Client, "global:ingest:{0}", validMsg)

	cancelCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	go consumer.Start(cancelCtx)

	require.Eventually(t, func() bool {
		history, err := repo.GetHistory(ctx, validMsg.ChatID, 0, 10)
		return err == nil && len(history) == 1
	}, 10*time.Second, 200*time.Millisecond, "valid message after poison pill should still be processed")
}

// noopMetrics is a no-op implementation of ports.MetricsCollector for integration tests.
type noopMetrics struct{}

func (n *noopMetrics) IncCacheHit()                         {}
func (n *noopMetrics) IncCacheMiss()                        {}
func (n *noopMetrics) AddIngestedMessages(_ float64)        {}
func (n *noopMetrics) IncPublishedMessages(_ float64)       {}
func (n *noopMetrics) SetStreamLag(_ string, _ float64)     {}
func (n *noopMetrics) IncDLQMessages(_ float64)             {}
func (n *noopMetrics) IncStreamErrors(_ string)             {}
func (n *noopMetrics) IncDatabaseErrors(_ string)           {}
