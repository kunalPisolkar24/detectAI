//go:build integration

package worker

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	mongorepo "github.com/kunalPisolkar24/detectAI/services/chats/internal/adapters/mongo"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/config"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/core/domain"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/testutil"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
)

// TestSharded_Worker_EndToEnd runs the full persistence path against the real
// sharded cluster (mongos) + standalone redis: EnsureSharding succeeds via
// mongos, worker consumes the stream, BulkUpsert lands sharded, GetHistory via
// mongos returns it. This is the production HA shape (MONGO_MODE=sharded).
func TestSharded_Worker_EndToEnd(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping sharded cluster test in short mode")
	}
	mongoFix := testutil.NewShardedMongoFixture(t, "sharded_worker_probe")
	redisFix := testutil.NewRedisFixture(t)

	ctx := context.Background()
	dbName := "sharded_worker_" + uuid.New().String()[:8]
	db := mongoFix.MongosClient.Database(dbName)
	require.NoError(t, mongorepo.EnsureIndexes(ctx, db))

	shardedCfg := &config.Config{
		RedisAddr:            "unused-in-test",
		BatchSize:            10,
		StreamPartitionCount: 1,
		MongoMode:            "sharded",
		MongoMaxPoolSize:     20,
		MongoMinPoolSize:     5,
		MongoServerTimeout:   15 * time.Second,
	}

	// Must actually shard via mongos (not soft-skip like single-node RS).
	require.NoError(t, mongorepo.EnsureSharding(ctx, mongoFix.MongosClient, dbName, shardedCfg.MongoMode))
	sharded, key, err := testutil.ShardedCollectionInfo(ctx, mongoFix.MongosClient, dbName)
	require.NoError(t, err)
	require.True(t, sharded, "worker E2E requires real sharding via mongos")
	require.Contains(t, key, "chat_id")

	repo := mongorepo.NewMongoRepository(db)
	consumer := NewConsumer(redisFix.Client, repo, shardedCfg, zap.NewNop(), &noopMetrics{})

	chatID := uuid.New().String()
	streamKey := "global:ingest:{0}"
	require.NoError(t, redisFix.Client.XGroupCreateMkStream(ctx, streamKey, "chat_persistence_group", "0").Err())

	msg1 := &domain.Message{ID: uuid.New().String(), ChatID: chatID, UserID: "user-1", Content: "sharded hello", CreatedAt: time.Now().UTC()}
	msg2 := &domain.Message{ID: uuid.New().String(), ChatID: chatID, UserID: "user-1", Content: "sharded world", CreatedAt: time.Now().UTC().Add(time.Millisecond)}
	publishRaw(t, redisFix.Client, streamKey, msg1)
	publishRaw(t, redisFix.Client, streamKey, msg2)

	cancelCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	go consumer.Start(cancelCtx)

	require.Eventually(t, func() bool {
		history, err := repo.GetHistory(ctx, chatID, 0, 10)
		return err == nil && len(history) == 2
	}, 15*time.Second, 200*time.Millisecond, "worker should persist 2 msgs via mongos within 15s")

	history, err := repo.GetHistory(ctx, chatID, 0, 10)
	require.NoError(t, err)
	ids := map[string]bool{}
	for _, m := range history {
		ids[m.ID] = true
		assert.Equal(t, chatID, m.ChatID)
	}
	assert.True(t, ids[msg1.ID] && ids[msg2.ID])
}
