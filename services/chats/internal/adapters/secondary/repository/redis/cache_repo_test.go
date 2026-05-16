//go:build integration

package redis_test

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	redisrepo "github.com/kunalPisolkar24/detectAI/services/chats/internal/adapters/secondary/repository/redis"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/core/domain"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/testutil"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCacheRepository_SaveAndGetRecentMessages(t *testing.T) {
	fix := testutil.NewRedisFixture(t)
	repo := redisrepo.NewCacheRepository(fix.Client, 24*time.Hour)
	ctx := context.Background()

	chatID := "chat-" + uuid.New().String()
	msg1 := &domain.Message{ID: uuid.New().String(), ChatID: chatID, Content: "first", CreatedAt: time.Now().UTC().Add(-time.Minute)}
	msg2 := &domain.Message{ID: uuid.New().String(), ChatID: chatID, Content: "second", CreatedAt: time.Now().UTC()}

	require.NoError(t, repo.SaveToCache(ctx, msg1))
	require.NoError(t, repo.SaveToCache(ctx, msg2))

	msgs, err := repo.GetRecentMessages(ctx, chatID)
	require.NoError(t, err)
	require.Len(t, msgs, 2)
	assert.Equal(t, msg2.ID, msgs[0].ID, "most recent message should be returned first")
}

func TestCacheRepository_SaveToCache_Idempotent(t *testing.T) {
	fix := testutil.NewRedisFixture(t)
	repo := redisrepo.NewCacheRepository(fix.Client, 24*time.Hour)
	ctx := context.Background()

	chatID := "chat-" + uuid.New().String()
	msg := &domain.Message{ID: uuid.New().String(), ChatID: chatID, Content: "hello", CreatedAt: time.Now().UTC()}

	require.NoError(t, repo.SaveToCache(ctx, msg))
	require.NoError(t, repo.SaveToCache(ctx, msg))

	msgs, err := repo.GetRecentMessages(ctx, chatID)
	require.NoError(t, err)
	assert.Len(t, msgs, 1, "saving the same message twice must not create duplicates")
}

func TestCacheRepository_GetRecentMessages_EmptyCache(t *testing.T) {
	fix := testutil.NewRedisFixture(t)
	repo := redisrepo.NewCacheRepository(fix.Client, 24*time.Hour)
	ctx := context.Background()

	msgs, err := repo.GetRecentMessages(ctx, "non-existent-chat")
	require.NoError(t, err)
	assert.Empty(t, msgs)
}

func TestCacheRepository_PopulateCache(t *testing.T) {
	fix := testutil.NewRedisFixture(t)
	repo := redisrepo.NewCacheRepository(fix.Client, 24*time.Hour)
	ctx := context.Background()

	chatID := "chat-" + uuid.New().String()
	messages := []*domain.Message{
		{ID: uuid.New().String(), ChatID: chatID, Content: "a", CreatedAt: time.Now().UTC().Add(-2 * time.Minute)},
		{ID: uuid.New().String(), ChatID: chatID, Content: "b", CreatedAt: time.Now().UTC().Add(-time.Minute)},
		{ID: uuid.New().String(), ChatID: chatID, Content: "c", CreatedAt: time.Now().UTC()},
	}

	require.NoError(t, repo.PopulateCache(ctx, chatID, messages))

	fetched, err := repo.GetRecentMessages(ctx, chatID)
	require.NoError(t, err)
	assert.Len(t, fetched, 3)
	assert.Equal(t, "c", fetched[0].Content, "most recent should be first")
}

func TestCacheRepository_DeleteCache(t *testing.T) {
	fix := testutil.NewRedisFixture(t)
	repo := redisrepo.NewCacheRepository(fix.Client, 24*time.Hour)
	ctx := context.Background()

	chatID := "chat-" + uuid.New().String()
	msg := &domain.Message{ID: uuid.New().String(), ChatID: chatID, Content: "x", CreatedAt: time.Now().UTC()}
	require.NoError(t, repo.SaveToCache(ctx, msg))

	require.NoError(t, repo.DeleteCache(ctx, chatID))

	msgs, err := repo.GetRecentMessages(ctx, chatID)
	require.NoError(t, err)
	assert.Empty(t, msgs)
}
