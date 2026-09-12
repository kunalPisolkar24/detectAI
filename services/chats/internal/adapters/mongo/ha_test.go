//go:build ha

package mongo_test

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	mongorepo "github.com/kunalPisolkar24/detectAI/services/chats/internal/adapters/mongo"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/core/domain"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/testutil"
	"github.com/kunalPisolkar24/detectAI/services/chats/pkg/database"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestHA_EnsureSharding_Idempotent verifies EnsureSharding is safe to call twice and
// soft-skips when not on mongos (single-node RS). This mirrors production where
// MONGO_MODE=sharded but the backend may be standalone/RS (Floci) vs elastic/mongos.
func TestHA_EnsureSharding_IdempotentOnRS(t *testing.T) {
	fix := testutil.NewMongoRSFixture(t, "chat_ha_sharding_test")
	ctx := context.Background()

	// First call should soft-skip or succeed, never hard-fail on RS.
	require.NoError(t, mongorepo.EnsureSharding(ctx, fix.Client, "chat_ha_sharding_test", "sharded"))
	// Second call must be idempotent (AlreadyInitialized path).
	require.NoError(t, mongorepo.EnsureSharding(ctx, fix.Client, "chat_ha_sharding_test", "sharded"))
	// Standalone mode must be no-op even on RS.
	require.NoError(t, mongorepo.EnsureSharding(ctx, fix.Client, "chat_ha_sharding_test", "standalone"))
}

// TestHA_EnsureSharding_StandaloneIsNoop confirms standalone mode is always no-op
// regardless of topology — catches regression where sharding is accidentally gated on RS state.
func TestHA_EnsureSharding_StandaloneIsNoop(t *testing.T) {
	fix := testutil.NewMongoRSFixture(t, "chat_ha_standalone_noop")
	ctx := context.Background()
	require.NoError(t, mongorepo.EnsureSharding(ctx, fix.Client, "chat_ha_standalone_noop", ""))
	require.NoError(t, mongorepo.EnsureSharding(ctx, fix.Client, "chat_ha_standalone_noop", "standalone"))
}

// TestHA_Repository_CrossChatIsolation validates the critical HA contract:
// every messages operation filters on chat_id (the shard key). On a sharded
// cluster missing the shard key would scatter or fail. This runs against RS
// (same bucket logic, different driver path) and asserts isolation still holds.
func TestHA_Repository_CrossChatIsolation(t *testing.T) {
	fix := testutil.NewMongoRSFixture(t, "chat_ha_isolation")
	ctx := context.Background()
	require.NoError(t, mongorepo.EnsureIndexes(ctx, fix.DB))
	repo := mongorepo.NewMongoRepository(fix.DB)

	chatA := uuid.New().String()
	chatB := uuid.New().String()

	msgsA := make([]*domain.Message, 5)
	for i := range msgsA {
		msgsA[i] = &domain.Message{
			ID:        uuid.New().String(),
			ChatID:    chatA,
			UserID:    "user-a",
			Content:   "hello A",
			CreatedAt: time.Now().UTC().Add(time.Duration(i) * time.Millisecond),
		}
	}
	msgsB := make([]*domain.Message, 5)
	for i := range msgsB {
		msgsB[i] = &domain.Message{
			ID:        uuid.New().String(),
			ChatID:    chatB,
			UserID:    "user-b",
			Content:   "hello B",
			CreatedAt: time.Now().UTC().Add(time.Duration(i) * time.Millisecond),
		}
	}

	require.NoError(t, repo.BulkUpsertMessages(ctx, msgsA))
	require.NoError(t, repo.BulkUpsertMessages(ctx, msgsB))

	histA, err := repo.GetHistory(ctx, chatA, 0, 10)
	require.NoError(t, err)
	assert.Len(t, histA, 5)
	for _, m := range histA {
		assert.Equal(t, chatA, m.ChatID, "GetHistory must never leak messages from other chat_id (shard key violation)")
	}

	histB, err := repo.GetHistory(ctx, chatB, 0, 10)
	require.NoError(t, err)
	assert.Len(t, histB, 5)
	for _, m := range histB {
		assert.Equal(t, chatB, m.ChatID)
	}
}

// TestHA_BulkUpsert_IdempotentOnRS ensures BulkUpsert idempotency holds under
// HA driver config (replicaSet, retryWrites=false). Idempotency is the worker's
// at-least-once guarantee during failover retries.
func TestHA_BulkUpsert_IdempotentOnRS(t *testing.T) {
	fix := testutil.NewMongoRSFixture(t, "chat_ha_idempotent")
	ctx := context.Background()
	require.NoError(t, mongorepo.EnsureIndexes(ctx, fix.DB))
	repo := mongorepo.NewMongoRepository(fix.DB)

	chatID := uuid.New().String()
	msg := &domain.Message{
		ID:        uuid.New().String(),
		ChatID:    chatID,
		UserID:    "user-1",
		Content:   "idempotent",
		CreatedAt: time.Now().UTC(),
	}
	require.NoError(t, repo.BulkUpsertMessages(ctx, []*domain.Message{msg}))
	require.NoError(t, repo.BulkUpsertMessages(ctx, []*domain.Message{msg}))

	history, err := repo.GetHistory(ctx, chatID, 0, 10)
	require.NoError(t, err)
	assert.Len(t, history, 1, "idempotent upsert must not duplicate on RS")
}

// TestHA_BulkUpsert_LargeBatchOnRS exercises bucketing (BucketCapacity=50) with
// sharded mode defaults (larger ServerSelectionTimeout). Large batch creates
// multiple buckets; GetHistory must fetch MaxBucketsFetch correctly under HA.
func TestHA_BulkUpsert_LargeBatchOnRS(t *testing.T) {
	fix := testutil.NewMongoRSFixture(t, "chat_ha_large_batch")
	ctx := context.Background()
	require.NoError(t, mongorepo.EnsureIndexes(ctx, fix.DB))
	repo := mongorepo.NewMongoRepository(fix.DB)

	chatID := uuid.New().String()
	const count = 120
	msgs := make([]*domain.Message, count)
	for i := range msgs {
		msgs[i] = &domain.Message{
			ID:        uuid.New().String(),
			ChatID:    chatID,
			UserID:    "user-1",
			Content:   "msg",
			CreatedAt: time.Now().UTC().Add(time.Duration(i) * time.Millisecond),
		}
	}
	require.NoError(t, repo.BulkUpsertMessages(ctx, msgs))

	history, err := repo.GetHistory(ctx, chatID, 0, 200)
	require.NoError(t, err)
	assert.Len(t, history, count)
}

// TestHA_Database_HAConnectConfig validates that database.ConnectMongo with HA-tuned
// pool/timeout (sharded defaults 20/5/15s) works against RS URI. This is the
// config.go sharded branch exercised without importing internal/config (cycle).
func TestHA_Database_HAConnectConfig(t *testing.T) {
	fix := testutil.NewMongoRSFixture(t, "chat_ha_connect_cfg")
	// Re-connect via pkg/database with HA defaults to ensure that path is covered
	ctx := context.Background()
	client, err := database.ConnectMongo(ctx, database.MongoConnectConfig{
		URI:           fix.URI,
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

	// Basic operation via new client proves HA pool/timeout + retryWrites=false works.
	db := client.Database("chat_ha_connect_cfg")
	require.NoError(t, mongorepo.EnsureIndexes(ctx, db))
	repo := mongorepo.NewMongoRepository(db)
	msg := &domain.Message{
		ID:        uuid.New().String(),
		ChatID:    uuid.New().String(),
		UserID:    "user-1",
		Content:   "ha connect",
		CreatedAt: time.Now().UTC(),
	}
	require.NoError(t, repo.BulkUpsertMessages(ctx, []*domain.Message{msg}))
	history, err := repo.GetHistory(ctx, msg.ChatID, 0, 10)
	require.NoError(t, err)
	assert.Len(t, history, 1)
}

// TestHA_GetHistory_PaginationOnRS ensures pagination offset/limit works correctly
// on RS — bucketLimit calc and SortMessagesDesc must not regress under HA.
func TestHA_GetHistory_PaginationOnRS(t *testing.T) {
	fix := testutil.NewMongoRSFixture(t, "chat_ha_pagination")
	ctx := context.Background()
	require.NoError(t, mongorepo.EnsureIndexes(ctx, fix.DB))
	repo := mongorepo.NewMongoRepository(fix.DB)

	chatID := uuid.New().String()
	const count = 30
	msgs := make([]*domain.Message, count)
	for i := range msgs {
		msgs[i] = &domain.Message{
			ID:        uuid.New().String(),
			ChatID:    chatID,
			UserID:    "user-1",
			Content:   "msg",
			CreatedAt: time.Now().UTC().Add(time.Duration(i) * time.Millisecond),
		}
	}
	require.NoError(t, repo.BulkUpsertMessages(ctx, msgs))

	p1, err := repo.GetHistory(ctx, chatID, 0, 10)
	require.NoError(t, err)
	assert.Len(t, p1, 10)
	p2, err := repo.GetHistory(ctx, chatID, 10, 10)
	require.NoError(t, err)
	assert.Len(t, p2, 10)
	assert.NotEqual(t, p1[0].ID, p2[0].ID, "pages should not overlap on RS")
}
