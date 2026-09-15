//go:build ha

package redis_test

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	redisrepo "github.com/kunalPisolkar24/detectAI/services/chats/internal/adapters/redis"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/config"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/core/domain"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/testutil"
	goredis "github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestHA_Redis_Auth_PublishAndCache validates the ElastiCache auth_token path
// (same redis:7-alpine, --requirepass) using *redis.Client + CHAT_REDIS_ADDR.
// This exercises redis/client.go:15 TLS/auth branch without TLS.
func TestHA_Redis_Auth_PublishAndCache(t *testing.T) {
	fix := testutil.NewRedisAuthFixture(t, "test_redis_ha_password")
	ctx := context.Background()

	// Dial via the same path production uses: config-driven *redis.Client
	cfg := &config.Config{
		RedisAddr:     fix.Addr,
		RedisPassword: fix.Password,
		RedisPoolSize: 10,
	}
	client, err := redisrepo.NewClient(cfg)
	require.NoError(t, err)
	defer client.Close()

	// Stream publish + cache save must work with AUTH
	streamRepo := redisrepo.NewStreamRepository(client, 4)
	cacheRepo := redisrepo.NewCacheRepository(client, 24*time.Hour)

	chatID := "chat-ha-auth-" + uuid.New().String()
	msg := &domain.Message{
		ID:        uuid.New().String(),
		ChatID:    chatID,
		UserID:    "user-1",
		Content:   "ha auth test",
		CreatedAt: time.Now().UTC(),
	}

	require.NoError(t, streamRepo.Publish(ctx, msg))
	require.NoError(t, cacheRepo.SaveToCache(ctx, msg))

	// Verify stream has entry
	streams, err := client.XRead(ctx, &goredis.XReadArgs{
		Streams: []string{"global:ingest:{0}", "0"},
		Count:   10,
		Block:   time.Second,
	}).Result()
	// Partition routing: with partitions=4, chatID hashes to one of 0..3.
	// We published with default partitions=4, so key may not be :0 — check length via XLEN fallback
	if err != nil || len(streams) == 0 {
		// Try all partitions to find the message
		found := false
		for i := 0; i < 4; i++ {
			key := "global:ingest:{" + string(rune('0'+i)) + "}"
			cnt, _ := client.XLen(ctx, key).Result()
			if cnt > 0 {
				found = true
				break
			}
		}
		assert.True(t, found, "published message should be in one of 4 partitions under AUTH")
	}

	// Verify cache retrieval
	cached, err := cacheRepo.GetRecentMessages(ctx, chatID)
	require.NoError(t, err)
	require.Len(t, cached, 1)
	assert.Equal(t, msg.ID, cached[0].ID)
}

// TestHA_Redis_PrimaryReplica_PrimaryIsSource validates ElastiCache 1+1 primary-for-all:
// all writes go to primary.Addr, replica is not used (same topology as
// infra/terraform/modules/elasticache: num_cache_clusters=2, primary-for-all).
// Replica kill must not affect primary ops.
func TestHA_Redis_PrimaryReplica_PrimaryIsSource(t *testing.T) {
	fix := testutil.NewRedisPrimaryReplicaFixture(t)
	ctx := context.Background()

	cfg := &config.Config{
		RedisAddr:     fix.PrimaryAddr,
		RedisPassword: fix.Password,
		RedisPoolSize: 10,
	}
	client, err := redisrepo.NewClient(cfg)
	require.NoError(t, err)
	defer client.Close()

	streamRepo := redisrepo.NewStreamRepository(client, 2)
	cacheRepo := redisrepo.NewCacheRepository(client, 24*time.Hour)

	chatID := "chat-ha-primary-" + uuid.New().String()
	msg1 := &domain.Message{
		ID:        uuid.New().String(),
		ChatID:    chatID,
		UserID:    "user-1",
		Content:   "before replica kill",
		CreatedAt: time.Now().UTC(),
	}
	require.NoError(t, streamRepo.Publish(ctx, msg1))
	require.NoError(t, cacheRepo.SaveToCache(ctx, msg1))

	// Kill replica — primary should remain unaffected (proves primary-for-all)
	replicaKillCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = fix.ReplicaContainer.Terminate(replicaKillCtx)

	// Brief pause for replica termination
	time.Sleep(500 * time.Millisecond)

	msg2 := &domain.Message{
		ID:        uuid.New().String(),
		ChatID:    chatID,
		UserID:    "user-1",
		Content:   "after replica kill",
		CreatedAt: time.Now().UTC(),
	}
	require.NoError(t, streamRepo.Publish(ctx, msg2), "publish via primary must succeed after replica terminated")
	require.NoError(t, cacheRepo.SaveToCache(ctx, msg2), "cache write via primary must succeed after replica terminated")

	cached, err := cacheRepo.GetRecentMessages(ctx, chatID)
	require.NoError(t, err)
	assert.Len(t, cached, 2, "both messages should be in cache after replica kill")

	// Ensure primary still pings
	require.NoError(t, client.Ping(ctx).Err())
}

// TestHA_Redis_Auth_WrongPassword validates that auth failure is surfaced
// (not silently degraded). This catches regression where REDIS_PASSWORD is ignored.
func TestHA_Redis_Auth_WrongPassword(t *testing.T) {
	fix := testutil.NewRedisAuthFixture(t, "correct_password")
	// Attempt with wrong password should fail Ping in NewClient
	badCfg := &config.Config{
		RedisAddr:     fix.Addr,
		RedisPassword: "wrong_password",
		RedisPoolSize: 5,
	}
	client, err := redisrepo.NewClient(badCfg)
	if err == nil {
		_ = client.Close()
		t.Fatal("NewClient with wrong password should fail")
	}
	assert.Error(t, err)
}

// TestHA_Redis_LuaSingleShardSafety ensures cache Lua script stays single-key
// (single-shard safe for ElastiCache cluster-disabled). Keys use {hash-tags}
// but scripts must not touch multiple shards — this test just verifies the
// Lua path still works under AUTH and doesn't introduce cross-slot.
func TestHA_Redis_LuaSingleShardSafety(t *testing.T) {
	fix := testutil.NewRedisAuthFixture(t, "test_redis_ha_password")
	ctx := context.Background()

	cfg := &config.Config{
		RedisAddr:     fix.Addr,
		RedisPassword: fix.Password,
		RedisPoolSize: 10,
	}
	client, err := redisrepo.NewClient(cfg)
	require.NoError(t, err)
	defer client.Close()

	cacheRepo := redisrepo.NewCacheRepository(client, 24*time.Hour)

	chatID := "chat-lua-ha-" + uuid.New().String()
	// Save same ID twice — Lua should dedup atomically
	msg := &domain.Message{
		ID:        uuid.New().String(),
		ChatID:    chatID,
		UserID:    "user-1",
		Content:   "lua dedup",
		CreatedAt: time.Now().UTC(),
	}
	require.NoError(t, cacheRepo.SaveToCache(ctx, msg))
	require.NoError(t, cacheRepo.SaveToCache(ctx, msg))

	cached, err := cacheRepo.GetRecentMessages(ctx, chatID)
	require.NoError(t, err)
	assert.Len(t, cached, 1, "Lua dedup must not create duplicates under HA auth")

	// PopulateCache with duplicates should also dedup
	msgs := []*domain.Message{
		{ID: msg.ID, ChatID: chatID, Content: "lua dedup", CreatedAt: time.Now().UTC()},
		{ID: uuid.New().String(), ChatID: chatID, Content: "second", CreatedAt: time.Now().UTC().Add(time.Millisecond)},
	}
	require.NoError(t, cacheRepo.PopulateCache(ctx, chatID, msgs))
	cached, err = cacheRepo.GetRecentMessages(ctx, chatID)
	require.NoError(t, err)
	assert.Len(t, cached, 2, "PopulateCache must dedup by ID under HA")
}

// TestHA_Redis_ConnectionErrorDetection validates IsRedisConnError contract
// used for degraded mode fallback (cmd/server/main.go). Failover should be
// classified as conn error, not generic.
func TestHA_Redis_ConnectionErrorDetection(t *testing.T) {
	fix := testutil.NewRedisAuthFixture(t, "test_redis_ha_password")
	ctx := context.Background()

	// Create a client pointing to a now-killed addr
	cfg := &config.Config{
		RedisAddr:     fix.Addr,
		RedisPassword: fix.Password,
		RedisPoolSize: 5,
	}
	client, err := redisrepo.NewClient(cfg)
	require.NoError(t, err)

	// Terminate container to force connection errors
	killCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = fix.Container.Terminate(killCtx)
	time.Sleep(300 * time.Millisecond)

	err = client.Ping(ctx).Err()
	require.Error(t, err)
	assert.True(t, redisrepo.IsRedisConnError(err), "killed redis should be classified as conn error for degraded fallback")

	_ = client.Close()

	// Ensure explicit ErrRedisUnavailable is also classified
	assert.True(t, redisrepo.IsRedisConnError(redisrepo.ErrRedisUnavailable))
}

// TestHA_Redis_StreamPartitionIsolation ensures same chat_id always lands on
// same partition even under HA (crc32 routing invariant). Critical for per-chat
// ordering when worker consumes per-partition.
func TestHA_Redis_StreamPartitionIsolation(t *testing.T) {
	fix := testutil.NewRedisAuthFixture(t, "test_redis_ha_password")
	ctx := context.Background()

	cfg := &config.Config{
		RedisAddr:     fix.Addr,
		RedisPassword: fix.Password,
		RedisPoolSize: 10,
	}
	client, err := redisrepo.NewClient(cfg)
	require.NoError(t, err)
	defer client.Close()

	// Use 4 partitions, same chatID should always map to same {p}
	const partitions = 4
	repo := redisrepo.NewStreamRepository(client, partitions)
	chatID := "chat-partition-ha-" + uuid.New().String()

	for i := 0; i < 5; i++ {
		msg := &domain.Message{
			ID:        uuid.New().String(),
			ChatID:    chatID,
			UserID:    "user-1",
			Content:   "msg",
			CreatedAt: time.Now().UTC(),
		}
		require.NoError(t, repo.Publish(ctx, msg))
	}

	// Only one partition should have 5 messages, others 0
	foundPartitions := 0
	var foundCount int64
	for i := 0; i < partitions; i++ {
		key := "global:ingest:{" + string(rune('0'+i)) + "}"
		cnt, err := client.XLen(ctx, key).Result()
		require.NoError(t, err)
		if cnt > 0 {
			foundPartitions++
			foundCount = cnt
		}
	}
	assert.Equal(t, 1, foundPartitions, "same chat_id must map to single partition under HA")
	assert.Equal(t, int64(5), foundCount)
}
