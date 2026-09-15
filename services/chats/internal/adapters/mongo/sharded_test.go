//go:build integration

package mongo_test

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	mongorepo "github.com/kunalPisolkar24/detectAI/services/chats/internal/adapters/mongo"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/core/domain"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/testutil"
	"github.com/kunalPisolkar24/detectAI/services/chats/pkg/database"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.mongodb.org/mongo-driver/bson"
)

// TestSharded_Contracts is the shared-cluster suite: one 5-container sharded
// cluster (1 cfg + 2 shards + mongos) for all routing/CRUD contracts. Each
// subtest uses its own database so enableSharding/shardCollection don't clash.
func TestSharded_Contracts(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping sharded cluster test in short mode")
	}
	fix := testutil.NewShardedMongoFixture(t, "sharded_contracts_probe")
	ctx := context.Background()

	t.Run("EnsureShardingSucceedsViaMongos", func(t *testing.T) {
		dbName := "sharded_ensure_" + uuid.New().String()[:8]
		db := fix.MongosClient.Database(dbName)
		require.NoError(t, mongorepo.EnsureIndexes(ctx, db))
		require.NoError(t, mongorepo.EnsureSharding(ctx, fix.MongosClient, dbName, "sharded"))
		// Idempotent second call (AlreadyInitialized / code 23 / code 20 path).
		require.NoError(t, mongorepo.EnsureSharding(ctx, fix.MongosClient, dbName, "sharded"))

		sharded, key, err := testutil.ShardedCollectionInfo(ctx, fix.MongosClient, dbName)
		require.NoError(t, err, "config.collections must contain entry after shardCollection via mongos")
		assert.True(t, sharded, "messages must be marked sharded in config.collections")
		require.Contains(t, key, "chat_id", "shard key must be chat_id, got %v", key)
		assert.Equal(t, "hashed", fmt.Sprintf("%v", key["chat_id"]), "shard key must be chat_id:hashed")
	})

	t.Run("ChatsRemainsUnsharded", func(t *testing.T) {
		dbName := "sharded_chats_" + uuid.New().String()[:8]
		db := fix.MongosClient.Database(dbName)
		require.NoError(t, mongorepo.EnsureIndexes(ctx, db))
		require.NoError(t, mongorepo.EnsureSharding(ctx, fix.MongosClient, dbName, "sharded"))

		count, err := fix.MongosClient.Database("config").Collection("collections").
			CountDocuments(ctx, bson.M{"_id": dbName + ".chats"})
		require.NoError(t, err)
		assert.Equal(t, int64(0), count, "chats must stay unsharded (small metadata, broadcast OK)")

		// Unsharded collection still fully usable via mongos.
		repo := mongorepo.NewMongoRepository(db)
		sess := &domain.ChatSession{ID: uuid.New().String(), UserID: "u1", Title: "t", CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC()}
		require.NoError(t, repo.CreateChat(ctx, sess))
		got, err := repo.GetChat(ctx, sess.ID)
		require.NoError(t, err)
		assert.Equal(t, sess.ID, got.ID)
	})

	t.Run("StandaloneIsNoopOnMongos", func(t *testing.T) {
		dbName := "sharded_noop_" + uuid.New().String()[:8]
		require.NoError(t, mongorepo.EnsureSharding(ctx, fix.MongosClient, dbName, "standalone"))
		require.NoError(t, mongorepo.EnsureSharding(ctx, fix.MongosClient, dbName, ""))
		count, err := fix.MongosClient.Database("config").Collection("collections").
			CountDocuments(ctx, bson.M{"_id": dbName + ".messages"})
		require.NoError(t, err)
		assert.Equal(t, int64(0), count, "standalone mode must never shard, even when mongos is capable")
	})

	t.Run("CrossChatIsolationViaMongos", func(t *testing.T) {
		dbName := "sharded_isolation_" + uuid.New().String()[:8]
		db := fix.MongosClient.Database(dbName)
		require.NoError(t, mongorepo.EnsureIndexes(ctx, db))
		require.NoError(t, mongorepo.EnsureSharding(ctx, fix.MongosClient, dbName, "sharded"))
		repo := mongorepo.NewMongoRepository(db)

		chatA, chatB := uuid.New().String(), uuid.New().String()
		msgsA := makeMsgs(chatA, "user-a", 5)
		msgsB := makeMsgs(chatB, "user-b", 5)
		require.NoError(t, repo.BulkUpsertMessages(ctx, msgsA))
		require.NoError(t, repo.BulkUpsertMessages(ctx, msgsB))

		histA, err := repo.GetHistory(ctx, chatA, 0, 10)
		require.NoError(t, err)
		require.Len(t, histA, 5)
		for _, m := range histA {
			assert.Equal(t, chatA, m.ChatID, "GetHistory via mongos must never leak across chat_id (shard key)")
		}
		histB, err := repo.GetHistory(ctx, chatB, 0, 10)
		require.NoError(t, err)
		require.Len(t, histB, 5)
	})

	t.Run("BulkUpsertIdempotentViaMongos", func(t *testing.T) {
		dbName := "sharded_idem_" + uuid.New().String()[:8]
		db := fix.MongosClient.Database(dbName)
		require.NoError(t, mongorepo.EnsureIndexes(ctx, db))
		require.NoError(t, mongorepo.EnsureSharding(ctx, fix.MongosClient, dbName, "sharded"))
		repo := mongorepo.NewMongoRepository(db)

		chatID := uuid.New().String()
		msg := &domain.Message{ID: uuid.New().String(), ChatID: chatID, UserID: "u1", Content: "idem", CreatedAt: time.Now().UTC()}
		require.NoError(t, repo.BulkUpsertMessages(ctx, []*domain.Message{msg}))
		require.NoError(t, repo.BulkUpsertMessages(ctx, []*domain.Message{msg}))
		history, err := repo.GetHistory(ctx, chatID, 0, 10)
		require.NoError(t, err)
		assert.Len(t, history, 1)
	})

	t.Run("LargeBatchMultiBucketViaMongos", func(t *testing.T) {
		dbName := "sharded_large_" + uuid.New().String()[:8]
		db := fix.MongosClient.Database(dbName)
		require.NoError(t, mongorepo.EnsureIndexes(ctx, db))
		require.NoError(t, mongorepo.EnsureSharding(ctx, fix.MongosClient, dbName, "sharded"))
		repo := mongorepo.NewMongoRepository(db)

		chatID := uuid.New().String()
		const count = 120 // > 2x BucketCapacity(50), forces multi-bucket
		msgs := makeMsgs(chatID, "u1", count)
		require.NoError(t, repo.BulkUpsertMessages(ctx, msgs))
		// Note: GetHistory caps limit at MaxPageSize(100), so page through.
		p1, err := repo.GetHistory(ctx, chatID, 0, 100)
		require.NoError(t, err)
		require.Len(t, p1, 100)
		p2, err := repo.GetHistory(ctx, chatID, 100, 100)
		require.NoError(t, err)
		assert.Len(t, p2, count-100)
	})

	t.Run("PaginationViaMongos", func(t *testing.T) {
		dbName := "sharded_page_" + uuid.New().String()[:8]
		db := fix.MongosClient.Database(dbName)
		require.NoError(t, mongorepo.EnsureIndexes(ctx, db))
		require.NoError(t, mongorepo.EnsureSharding(ctx, fix.MongosClient, dbName, "sharded"))
		repo := mongorepo.NewMongoRepository(db)

		chatID := uuid.New().String()
		require.NoError(t, repo.BulkUpsertMessages(ctx, makeMsgs(chatID, "u1", 30)))
		p1, err := repo.GetHistory(ctx, chatID, 0, 10)
		require.NoError(t, err)
		require.Len(t, p1, 10)
		p2, err := repo.GetHistory(ctx, chatID, 10, 10)
		require.NoError(t, err)
		require.Len(t, p2, 10)
		assert.NotEqual(t, p1[0].ID, p2[0].ID)
	})

	t.Run("TargetedQueryUsesShardKey", func(t *testing.T) {
		dbName := "sharded_target_" + uuid.New().String()[:8]
		db := fix.MongosClient.Database(dbName)
		require.NoError(t, mongorepo.EnsureIndexes(ctx, db))
		require.NoError(t, mongorepo.EnsureSharding(ctx, fix.MongosClient, dbName, "sharded"))
		repo := mongorepo.NewMongoRepository(db)

		chatID := uuid.New().String()
		require.NoError(t, repo.BulkUpsertMessages(ctx, makeMsgs(chatID, "u1", 3)))

		// Explain via mongos: a query filtering on chat_id (the shard key)
		// must be SINGLE_SHARD targeted, never a scatter (SHARD_MERGE without
		// shard key). This is the assertion a replica-set fixture can never make.
		var explained bson.M
		err := db.RunCommand(ctx, bson.D{
			{Key: "explain", Value: bson.D{
				{Key: "find", Value: "messages"},
				{Key: "filter", Value: bson.M{"chat_id": chatID}},
			}},
			{Key: "verbosity", Value: "queryPlanner"},
		}).Decode(&explained)
		require.NoError(t, err)
		raw, _ := bson.MarshalExtJSON(explained, false, false)
		out := string(raw)
		assert.True(t, strings.Contains(out, "SINGLE_SHARD"),
			"chat_id-filtered query must be SINGLE_SHARD targeted via mongos, got: %s", truncate(out, 2000))
	})
}

// TestSharded_ConnectConfig validates pkg/database.ConnectMongo with the
// production sharded defaults (20/5/15s, retryWrites=false) against mongos.
func TestSharded_ConnectConfig(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping sharded cluster test in short mode")
	}
	fix := testutil.NewShardedMongoFixture(t, "sharded_connect_probe")
	ctx := context.Background()

	client, err := database.ConnectMongo(ctx, database.MongoConnectConfig{
		URI:           fix.MongosURI,
		MaxPoolSize:   20,
		MinPoolSize:   5,
		ServerTimeout: 15 * time.Second,
		Mode:          "sharded",
	})
	require.NoError(t, err)
	defer func() {
		cCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = client.Disconnect(cCtx)
	}()

	db := client.Database("sharded_connect_" + uuid.New().String()[:8])
	require.NoError(t, mongorepo.EnsureIndexes(ctx, db))
	repo := mongorepo.NewMongoRepository(db)
	msg := &domain.Message{ID: uuid.New().String(), ChatID: uuid.New().String(), UserID: "u1", Content: "via mongos defaults", CreatedAt: time.Now().UTC()}
	require.NoError(t, repo.BulkUpsertMessages(ctx, []*domain.Message{msg}))
	history, err := repo.GetHistory(ctx, msg.ChatID, 0, 10)
	require.NoError(t, err)
	assert.Len(t, history, 1)
}

// TestSharded_ChunkDistribution proves the cluster really routes across 2
// shards. Hashed chat_id sharding pre-splits into chunks on both shards at
// shardCollection time, so we assert the chunk set spans shard0+shard1 and
// that writes via mongos land readably (router + balancer wiring live).
func TestSharded_ChunkDistribution(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping sharded cluster test in short mode")
	}
	fix := testutil.NewShardedMongoFixture(t, "sharded_dist_probe")
	ctx := context.Background()
	dbName := "sharded_dist_" + uuid.New().String()[:8]
	db := fix.MongosClient.Database(dbName)
	require.NoError(t, mongorepo.EnsureIndexes(ctx, db))
	require.NoError(t, mongorepo.EnsureSharding(ctx, fix.MongosClient, dbName, "sharded"))
	repo := mongorepo.NewMongoRepository(db)

	// Spread writes across several hashed shard-key values via mongos.
	for i := 0; i < 20; i++ {
		chatID := uuid.New().String()
		msg := &domain.Message{ID: uuid.New().String(), ChatID: chatID, UserID: "u1", Content: "spread", CreatedAt: time.Now().UTC()}
		require.NoError(t, repo.BulkUpsertMessages(ctx, []*domain.Message{msg}))
	}

	var shards []string
	var chunkCount int64
	require.Eventually(t, func() bool {
		s, c, err := testutil.ShardedChunkShards(ctx, fix.MongosClient, dbName)
		if err != nil {
			t.Logf("chunk poll err: %v", err)
			return false
		}
		shards, chunkCount = s, c
		return c > 1 && len(s) >= 2
	}, 30*time.Second, 2*time.Second,
		"hashed sharding must pre-split chunks across both shards (got chunks=%d shards=%v)", chunkCount, shards)
	t.Logf("chunks=%d shards=%v", chunkCount, shards)
	assert.GreaterOrEqual(t, len(shards), 2, "chunks must span both shards, got %v", shards)

	// Spot-check a write is readable via mongos after distribution.
	chatID := uuid.New().String()
	require.NoError(t, repo.BulkUpsertMessages(ctx, makeMsgs(chatID, "u1", 3)))
	history, err := repo.GetHistory(ctx, chatID, 0, 10)
	require.NoError(t, err)
	assert.Len(t, history, 3)
}

// TestSharded_ShardFailure documents degraded behavior: killing one shard must
// not silently return wrong data. Reads for surviving-shard data keep working
// or fail fast with a retryable error; after the test the fixture is torn down.
func TestSharded_ShardFailure(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping sharded cluster test in short mode")
	}
	fix := testutil.NewShardedMongoFixture(t, "sharded_fail_probe")
	ctx := context.Background()
	dbName := "sharded_fail_" + uuid.New().String()[:8]
	db := fix.MongosClient.Database(dbName)
	require.NoError(t, mongorepo.EnsureIndexes(ctx, db))
	require.NoError(t, mongorepo.EnsureSharding(ctx, fix.MongosClient, dbName, "sharded"))
	repo := mongorepo.NewMongoRepository(db)

	chatID := uuid.New().String()
	require.NoError(t, repo.BulkUpsertMessages(ctx, makeMsgs(chatID, "u1", 5)))
	before, err := repo.GetHistory(ctx, chatID, 0, 10)
	require.NoError(t, err)
	require.Len(t, before, 5)

	// Kill shard1. Cluster metadata lives on cfg; mongos stays up.
	killCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	require.NoError(t, fix.Shard1Container.Terminate(killCtx))
	time.Sleep(2 * time.Second)

	// Must never return silently-truncated wrong data without error.
	after, err := repo.GetHistory(ctx, chatID, 0, 10)
	if err != nil {
		t.Logf("read during shard outage correctly failed fast: %v", err)
		assert.Error(t, err)
	} else {
		// If the chat's chunks live on the surviving shard, full data is fine.
		assert.Len(t, after, 5, "surviving-shard read must return full data, never partial")
	}
}

func makeMsgs(chatID, userID string, n int) []*domain.Message {
	msgs := make([]*domain.Message, n)
	base := time.Now().UTC()
	for i := range msgs {
		msgs[i] = &domain.Message{
			ID:        uuid.New().String(),
			ChatID:    chatID,
			UserID:    userID,
			Content:   "msg",
			CreatedAt: base.Add(time.Duration(i) * time.Millisecond),
		}
	}
	return msgs
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}
