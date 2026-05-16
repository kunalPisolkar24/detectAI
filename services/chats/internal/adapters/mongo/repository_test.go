//go:build integration

package mongo_test

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	mongoclient "github.com/kunalPisolkar24/detectAI/services/chats/internal/adapters/mongo"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/core/domain"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/testutil"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func newTestRepo(t *testing.T) (*mongoclient.MongoRepository, context.Context) {
	t.Helper()
	fix := testutil.NewMongoFixture(t, "chat_test_db")
	ctx := context.Background()
	require.NoError(t, mongoclient.EnsureIndexes(ctx, fix.DB))
	return mongoclient.NewMongoRepository(fix.DB), ctx
}

func TestMongoRepository_CreateAndGetChat(t *testing.T) {
	repo, ctx := newTestRepo(t)

	session := &domain.ChatSession{
		ID:        uuid.New().String(),
		UserID:    "user-1",
		Title:     "My Chat",
		CreatedAt: time.Now().UTC().Truncate(time.Millisecond),
		UpdatedAt: time.Now().UTC().Truncate(time.Millisecond),
	}

	err := repo.CreateChat(ctx, session)
	require.NoError(t, err)

	fetched, err := repo.GetChat(ctx, session.ID)
	require.NoError(t, err)
	assert.Equal(t, session.ID, fetched.ID)
	assert.Equal(t, session.UserID, fetched.UserID)
	assert.Equal(t, session.Title, fetched.Title)
}

func TestMongoRepository_GetChat_NotFound(t *testing.T) {
	repo, ctx := newTestRepo(t)

	_, err := repo.GetChat(ctx, "non-existent-id")
	assert.Error(t, err)
}

func TestMongoRepository_GetUserChats_SortedByUpdatedAt(t *testing.T) {
	repo, ctx := newTestRepo(t)
	userID := "user-sort-" + uuid.New().String()

	older := &domain.ChatSession{ID: uuid.New().String(), UserID: userID, Title: "Older", UpdatedAt: time.Now().UTC().Add(-time.Hour)}
	newer := &domain.ChatSession{ID: uuid.New().String(), UserID: userID, Title: "Newer", UpdatedAt: time.Now().UTC()}

	require.NoError(t, repo.CreateChat(ctx, older))
	require.NoError(t, repo.CreateChat(ctx, newer))

	chats, err := repo.GetUserChats(ctx, userID, 50)
	require.NoError(t, err)
	require.Len(t, chats, 2)
	assert.Equal(t, "Newer", chats[0].Title, "most recently updated should come first")
}

func TestMongoRepository_UpdateChatTitle(t *testing.T) {
	repo, ctx := newTestRepo(t)

	session := &domain.ChatSession{ID: uuid.New().String(), UserID: "user-1", Title: "Original"}
	require.NoError(t, repo.CreateChat(ctx, session))

	require.NoError(t, repo.UpdateChatTitle(ctx, session.ID, "Updated"))

	fetched, err := repo.GetChat(ctx, session.ID)
	require.NoError(t, err)
	assert.Equal(t, "Updated", fetched.Title)
}

func TestMongoRepository_DeleteChat(t *testing.T) {
	repo, ctx := newTestRepo(t)

	session := &domain.ChatSession{ID: uuid.New().String(), UserID: "user-1", Title: "To Delete"}
	require.NoError(t, repo.CreateChat(ctx, session))

	require.NoError(t, repo.DeleteChat(ctx, session.ID))

	_, err := repo.GetChat(ctx, session.ID)
	assert.Error(t, err, "fetching deleted chat should fail")
}

func TestMongoRepository_BulkUpsertMessages_Idempotent(t *testing.T) {
	repo, ctx := newTestRepo(t)

	chatID := uuid.New().String()
	msg := &domain.Message{
		ID:        uuid.New().String(),
		ChatID:    chatID,
		UserID:    "user-1",
		Content:   "Hello",
		CreatedAt: time.Now().UTC(),
	}

	require.NoError(t, repo.BulkUpsertMessages(ctx, []*domain.Message{msg}))
	require.NoError(t, repo.BulkUpsertMessages(ctx, []*domain.Message{msg}), "second upsert (same ID) must be idempotent")

	history, err := repo.GetHistory(ctx, chatID, 0, 50)
	require.NoError(t, err)
	assert.Len(t, history, 1, "idempotent upsert must not create duplicate messages")
}

func TestMongoRepository_BulkUpsertMessages_LargeBatch(t *testing.T) {
	repo, ctx := newTestRepo(t)

	chatID := uuid.New().String()
	const count = 120
	messages := make([]*domain.Message, count)
	for i := range messages {
		messages[i] = &domain.Message{
			ID:        uuid.New().String(),
			ChatID:    chatID,
			UserID:    "user-1",
			Content:   "message",
			CreatedAt: time.Now().UTC().Add(time.Duration(i) * time.Millisecond),
		}
	}

	require.NoError(t, repo.BulkUpsertMessages(ctx, messages))

	history, err := repo.GetHistory(ctx, chatID, 0, 200)
	require.NoError(t, err)
	assert.Len(t, history, count)
}

func TestMongoRepository_GetHistory_Pagination(t *testing.T) {
	repo, ctx := newTestRepo(t)

	chatID := uuid.New().String()
	const count = 30
	messages := make([]*domain.Message, count)
	for i := range messages {
		messages[i] = &domain.Message{
			ID:        uuid.New().String(),
			ChatID:    chatID,
			UserID:    "user-1",
			Content:   "message",
			CreatedAt: time.Now().UTC().Add(time.Duration(i) * time.Millisecond),
		}
	}
	require.NoError(t, repo.BulkUpsertMessages(ctx, messages))

	page1, err := repo.GetHistory(ctx, chatID, 0, 10)
	require.NoError(t, err)
	assert.Len(t, page1, 10)

	page2, err := repo.GetHistory(ctx, chatID, 10, 10)
	require.NoError(t, err)
	assert.Len(t, page2, 10)

	assert.NotEqual(t, page1[0].ID, page2[0].ID, "pages should not overlap")
}
