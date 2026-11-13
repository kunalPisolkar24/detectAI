// Package repository_test drives the repository against a container-backed mongo.
package repository_test

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"go.mongodb.org/mongo-driver/v2/bson"
	driver "go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/db"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/models"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/repository"
	"github.com/kunalPisolkar24/detectAI/services/chats/tests/integration/support"
)

const testDatabase = "chat_db_test"

func TestMain(m *testing.M) {
	support.Main(m)
}

// owner returns an identity no other test shares.
func owner() string {
	return "owner-" + uuid.NewString()
}

func newRepository(t *testing.T) *repository.Mongo {
	t.Helper()
	dbClient := connectContainer(t)
	repo, err := repository.New(testContext(t), dbClient.Database())
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	return repo
}

func testContext(t *testing.T) context.Context {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	t.Cleanup(cancel)
	return ctx
}

func createChat(t *testing.T, repo *repository.Mongo, ownerID, title string) models.Chat {
	t.Helper()
	chat, err := repo.CreateChat(testContext(t), ownerID, title)
	if err != nil {
		t.Fatalf("CreateChat: %v", err)
	}
	return chat
}

func assertErrorIs(t *testing.T, err error, target error) {
	t.Helper()
	if !errors.Is(err, target) {
		t.Fatalf("err = %v, want %v", err, target)
	}
}

// countMessages counts the messages left on a chat.
func countMessages(t *testing.T, chatID string) int64 {
	t.Helper()
	count, err := connectContainer(t).Database().
		Collection("messages").
		CountDocuments(testContext(t), bson.M{"chat_id": chatID})
	if err != nil {
		t.Fatalf("CountDocuments: %v", err)
	}
	return count
}

// connectContainer dials the client against the package's mongo container.
func connectContainer(t *testing.T) *db.Client {
	t.Helper()
	uri := support.Mongo(t).URI
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	client, err := db.Connect(ctx, uri, testDatabase)
	if err != nil {
		t.Fatalf("Connect: %v", err)
	}
	t.Cleanup(func() {
		disCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = client.Disconnect(disCtx)
	})
	return client
}

// The repository bootstrap creates the indexes, and a second create against the
// same server proves the identical create is a no-op.
func TestNewEnsuresDataModelIndexes(t *testing.T) {
	newRepository(t)

	chats := indexKeys(t, "chats")
	if !chats["user_id:1,updated_at:-1"] {
		t.Errorf("chats indexes = %v, want the sidebar index {user_id: 1, updated_at: -1}", chats)
	}
	messages := indexKeys(t, "messages")
	if !messages["chat_id:1,created_at:-1,_id:-1"] {
		t.Errorf("messages indexes = %v, want the history index {chat_id: 1, created_at: -1, _id: -1}", messages)
	}
}

func TestCreateChatStoresOwnerAndTitle(t *testing.T) {
	repo := newRepository(t)
	ownerID := owner()

	chat := createChat(t, repo, ownerID, "first question")

	if chat.ID == "" {
		t.Error("chat id is empty, want a server-generated id")
	}
	if chat.UserID != ownerID {
		t.Errorf("user id = %q, want %q", chat.UserID, ownerID)
	}
	if chat.Title != "first question" {
		t.Errorf("title = %q, want %q", chat.Title, "first question")
	}
	if chat.CreatedAt.IsZero() || chat.UpdatedAt.IsZero() {
		t.Errorf("timestamps = %v/%v, want both set", chat.CreatedAt, chat.UpdatedAt)
	}

	stored, err := repo.Chat(testContext(t), ownerID, chat.ID)
	if err != nil {
		t.Fatalf("Chat: %v", err)
	}
	if stored.ID != chat.ID || stored.Title != chat.Title {
		t.Errorf("stored chat = %+v, want id %q and title %q", stored, chat.ID, chat.Title)
	}
}

func TestChatRejectsAnotherOwner(t *testing.T) {
	repo := newRepository(t)
	chat := createChat(t, repo, owner(), "private")

	_, err := repo.Chat(testContext(t), owner(), chat.ID)
	assertErrorIs(t, err, models.ErrNotFound)
}

func TestChatsListsNewestFirst(t *testing.T) {
	repo := newRepository(t)
	ownerID := owner()

	oldest := createChat(t, repo, ownerID, "oldest")
	time.Sleep(2 * time.Millisecond)
	middle := createChat(t, repo, ownerID, "middle")
	time.Sleep(2 * time.Millisecond)
	newest := createChat(t, repo, ownerID, "newest")

	summaries, err := repo.Chats(testContext(t), ownerID, 0)
	if err != nil {
		t.Fatalf("Chats: %v", err)
	}
	if len(summaries) != 3 {
		t.Fatalf("summaries = %d, want 3", len(summaries))
	}
	want := []string{newest.ID, middle.ID, oldest.ID}
	for i, id := range want {
		if summaries[i].ID != id {
			t.Errorf("summary %d = %q, want %q", i, summaries[i].ID, id)
		}
	}

	limited, err := repo.Chats(testContext(t), ownerID, 2)
	if err != nil {
		t.Fatalf("Chats: %v", err)
	}
	if len(limited) != 2 {
		t.Fatalf("limited summaries = %d, want 2", len(limited))
	}
	if limited[0].ID != newest.ID {
		t.Errorf("limited summary 0 = %q, want %q", limited[0].ID, newest.ID)
	}
}

func TestRenameChatUpdatesSummary(t *testing.T) {
	repo := newRepository(t)
	ownerID := owner()
	chat := createChat(t, repo, ownerID, "before")

	// bson stores datetimes at millisecond precision, so the rename needs a
	// gap to land on a later order key.
	time.Sleep(2 * time.Millisecond)

	summary, err := repo.RenameChat(testContext(t), ownerID, chat.ID, "after")
	if err != nil {
		t.Fatalf("RenameChat: %v", err)
	}
	if summary.ID != chat.ID {
		t.Errorf("summary id = %q, want %q", summary.ID, chat.ID)
	}
	if summary.Title != "after" {
		t.Errorf("title = %q, want %q", summary.Title, "after")
	}
	if !summary.UpdatedAt.After(chat.UpdatedAt) {
		t.Errorf("updated at = %v, want it past %v", summary.UpdatedAt, chat.UpdatedAt)
	}
}

func TestRenameChatRejectsAnotherOwner(t *testing.T) {
	repo := newRepository(t)
	chat := createChat(t, repo, owner(), "private")

	_, err := repo.RenameChat(testContext(t), owner(), chat.ID, "hijacked")
	assertErrorIs(t, err, models.ErrNotFound)
}

func TestDeleteChatRemovesChatAndMessages(t *testing.T) {
	repo := newRepository(t)
	ownerID := owner()
	chat := createChat(t, repo, ownerID, "doomed")
	_, err := repo.SaveUserMessage(testContext(t), ownerID, models.Message{
		ID:      uuid.NewString(),
		ChatID:  chat.ID,
		Role:    models.RoleUser,
		Content: "hello",
	})
	if err != nil {
		t.Fatalf("SaveUserMessage: %v", err)
	}

	if err := repo.DeleteChat(testContext(t), ownerID, chat.ID); err != nil {
		t.Fatalf("DeleteChat: %v", err)
	}

	_, err = repo.Chat(testContext(t), ownerID, chat.ID)
	assertErrorIs(t, err, models.ErrNotFound)
	if count := countMessages(t, chat.ID); count != 0 {
		t.Errorf("messages left = %d, want 0", count)
	}
}

func TestDeleteChatIsIdempotent(t *testing.T) {
	repo := newRepository(t)
	ownerID := owner()
	chat := createChat(t, repo, ownerID, "doomed")

	if err := repo.DeleteChat(testContext(t), ownerID, chat.ID); err != nil {
		t.Fatalf("DeleteChat: %v", err)
	}
	if err := repo.DeleteChat(testContext(t), ownerID, chat.ID); err != nil {
		t.Fatalf("re-delete = %v, want nil", err)
	}
}

func TestDeleteChatRejectsAnotherOwner(t *testing.T) {
	repo := newRepository(t)
	ownerID := owner()
	chat := createChat(t, repo, ownerID, "private")

	err := repo.DeleteChat(testContext(t), owner(), chat.ID)
	assertErrorIs(t, err, models.ErrNotFound)

	if _, err := repo.Chat(testContext(t), ownerID, chat.ID); err != nil {
		t.Fatalf("Chat after the rejected delete: %v", err)
	}
}

func TestSaveUserMessageStoresTheMessage(t *testing.T) {
	repo := newRepository(t)
	ownerID := owner()
	chat := createChat(t, repo, ownerID, "thread")

	saved, err := repo.SaveUserMessage(testContext(t), ownerID, models.Message{
		ID:      uuid.NewString(),
		ChatID:  chat.ID,
		Role:    models.RoleUser,
		Content: "hello there",
	})
	if err != nil {
		t.Fatalf("SaveUserMessage: %v", err)
	}
	if saved.Content != "hello there" {
		t.Errorf("content = %q, want %q", saved.Content, "hello there")
	}
	if saved.CreatedAt.IsZero() {
		t.Error("created at is zero, want the server timestamp")
	}
}

func TestSaveUserMessageReplaysTheStoredMessage(t *testing.T) {
	repo := newRepository(t)
	ownerID := owner()
	chat := createChat(t, repo, ownerID, "thread")
	id := uuid.NewString()

	first, err := repo.SaveUserMessage(testContext(t), ownerID, models.Message{
		ID:      id,
		ChatID:  chat.ID,
		Role:    models.RoleUser,
		Content: "the original",
	})
	if err != nil {
		t.Fatalf("SaveUserMessage: %v", err)
	}

	replay, err := repo.SaveUserMessage(testContext(t), ownerID, models.Message{
		ID:      id,
		ChatID:  chat.ID,
		Role:    models.RoleUser,
		Content: "a different take",
	})
	if err != nil {
		t.Fatalf("replay: %v", err)
	}
	if replay.Content != "the original" {
		t.Errorf("content = %q, want the stored %q", replay.Content, "the original")
	}
	if !replay.CreatedAt.Equal(first.CreatedAt) {
		t.Errorf("created at = %v, want %v", replay.CreatedAt, first.CreatedAt)
	}
}

func TestSaveUserMessageRejectsMessageBoundToAnotherChat(t *testing.T) {
	repo := newRepository(t)
	ownerID := owner()
	first := createChat(t, repo, ownerID, "first")
	second := createChat(t, repo, ownerID, "second")
	id := uuid.NewString()

	_, err := repo.SaveUserMessage(testContext(t), ownerID, models.Message{
		ID:      id,
		ChatID:  first.ID,
		Role:    models.RoleUser,
		Content: "hello",
	})
	if err != nil {
		t.Fatalf("SaveUserMessage: %v", err)
	}

	_, err = repo.SaveUserMessage(testContext(t), ownerID, models.Message{
		ID:      id,
		ChatID:  second.ID,
		Role:    models.RoleUser,
		Content: "hello",
	})
	assertErrorIs(t, err, models.ErrNotFound)
}

func TestSaveUserMessageRejectsAnotherOwner(t *testing.T) {
	repo := newRepository(t)
	chat := createChat(t, repo, owner(), "private")

	_, err := repo.SaveUserMessage(testContext(t), owner(), models.Message{
		ID:      uuid.NewString(),
		ChatID:  chat.ID,
		Role:    models.RoleUser,
		Content: "hello",
	})
	assertErrorIs(t, err, models.ErrNotFound)
}

func TestSaveUserMessageBumpsTheSidebarOrder(t *testing.T) {
	repo := newRepository(t)
	ownerID := owner()
	quiet := createChat(t, repo, ownerID, "quiet")
	time.Sleep(2 * time.Millisecond)
	busy := createChat(t, repo, ownerID, "busy")

	time.Sleep(2 * time.Millisecond)
	if _, err := repo.SaveUserMessage(testContext(t), ownerID, models.Message{
		ID:      uuid.NewString(),
		ChatID:  quiet.ID,
		Role:    models.RoleUser,
		Content: "hello",
	}); err != nil {
		t.Fatalf("SaveUserMessage: %v", err)
	}

	summaries, err := repo.Chats(testContext(t), ownerID, 0)
	if err != nil {
		t.Fatalf("Chats: %v", err)
	}
	if len(summaries) != 2 {
		t.Fatalf("summaries = %d, want 2", len(summaries))
	}
	if summaries[0].ID != quiet.ID {
		t.Errorf("first summary = %q, want the appended chat %q", summaries[0].ID, quiet.ID)
	}
	if summaries[1].ID != busy.ID {
		t.Errorf("second summary = %q, want %q", summaries[1].ID, busy.ID)
	}
}

func TestSaveAnalysisMessageWalksTheStateMachine(t *testing.T) {
	repo := newRepository(t)
	ownerID := owner()
	chat := createChat(t, repo, ownerID, "thread")
	id := uuid.NewString()

	running, err := repo.SaveAnalysisMessage(testContext(t), ownerID, models.Message{
		ID:     id,
		ChatID: chat.ID,
		Role:   models.RoleAssistant,
		Analysis: &models.Analysis{
			State:           models.StateRunning,
			Model:           models.ModelSpark,
			SourceMessageID: "m1",
		},
	})
	if err != nil {
		t.Fatalf("SaveAnalysisMessage: %v", err)
	}
	if running.Analysis == nil || running.Analysis.State != models.StateRunning {
		t.Fatalf("analysis = %+v, want the running state", running.Analysis)
	}

	completed, err := repo.SaveAnalysisMessage(testContext(t), ownerID, models.Message{
		ID:     id,
		ChatID: chat.ID,
		Role:   models.RoleAssistant,
		Analysis: &models.Analysis{
			State:           models.StateCompleted,
			Model:           models.ModelSpark,
			SourceMessageID: "m1",
			Result: &models.AnalysisResult{
				Label:      models.LabelAI,
				Confidence: 0.9,
				Scores:     models.Scores{AI: 0.9, Human: 0.1},
				Highlights: []models.Highlight{{CharStart: 0, CharEnd: 4, AIConfidence: 0.8, Label: models.LabelAI}},
				Raw:        map[string]any{"nested": map[string]any{"score": 0.5}},
			},
		},
	})
	if err != nil {
		t.Fatalf("SaveAnalysisMessage: %v", err)
	}
	if completed.Analysis == nil || completed.Analysis.State != models.StateCompleted {
		t.Fatalf("analysis = %+v, want the completed state", completed.Analysis)
	}
	if completed.Analysis.Result == nil || completed.Analysis.Result.Label != models.LabelAI {
		t.Errorf("result = %+v, want the ai verdict", completed.Analysis.Result)
	}
	if !completed.CreatedAt.Equal(running.CreatedAt) {
		t.Errorf("created at = %v, want the inserted %v", completed.CreatedAt, running.CreatedAt)
	}
}

func TestSaveAnalysisMessageAcceptsAnIdenticalReplay(t *testing.T) {
	repo := newRepository(t)
	ownerID := owner()
	chat := createChat(t, repo, ownerID, "thread")
	id := uuid.NewString()
	failed := &models.Analysis{
		State:           models.StateFailed,
		Model:           models.ModelSpark,
		SourceMessageID: "m1",
		Error:           "inference timeout",
	}

	if _, err := repo.SaveAnalysisMessage(testContext(t), ownerID, models.Message{
		ID:       id,
		ChatID:   chat.ID,
		Role:     models.RoleAssistant,
		Analysis: failed,
	}); err != nil {
		t.Fatalf("SaveAnalysisMessage: %v", err)
	}

	replay, err := repo.SaveAnalysisMessage(testContext(t), ownerID, models.Message{
		ID:       id,
		ChatID:   chat.ID,
		Role:     models.RoleAssistant,
		Analysis: failed,
	})
	if err != nil {
		t.Fatalf("replay: %v", err)
	}
	if replay.Analysis == nil || replay.Analysis.Error != "inference timeout" {
		t.Errorf("analysis = %+v, want the stored failure", replay.Analysis)
	}
}

func TestSaveAnalysisMessageRejectsANonReplayTerminalWrite(t *testing.T) {
	repo := newRepository(t)
	ownerID := owner()
	chat := createChat(t, repo, ownerID, "thread")
	id := uuid.NewString()

	if _, err := repo.SaveAnalysisMessage(testContext(t), ownerID, models.Message{
		ID:     id,
		ChatID: chat.ID,
		Role:   models.RoleAssistant,
		Analysis: &models.Analysis{
			State:           models.StateCompleted,
			Model:           models.ModelSpark,
			SourceMessageID: "m1",
			Result: &models.AnalysisResult{
				Label:      models.LabelAI,
				Confidence: 0.9,
				Scores:     models.Scores{AI: 0.9, Human: 0.1},
			},
		},
	}); err != nil {
		t.Fatalf("SaveAnalysisMessage: %v", err)
	}

	_, err := repo.SaveAnalysisMessage(testContext(t), ownerID, models.Message{
		ID:     id,
		ChatID: chat.ID,
		Role:   models.RoleAssistant,
		Analysis: &models.Analysis{
			State:           models.StateCompleted,
			Model:           models.ModelSpark,
			SourceMessageID: "m1",
			Result: &models.AnalysisResult{
				Label:      models.LabelHuman,
				Confidence: 0.2,
				Scores:     models.Scores{AI: 0.2, Human: 0.8},
			},
		},
	})
	assertErrorIs(t, err, models.ErrConflict)
}

func TestSaveAnalysisMessageRejectsMessageBoundToAnotherChat(t *testing.T) {
	repo := newRepository(t)
	ownerID := owner()
	first := createChat(t, repo, ownerID, "first")
	second := createChat(t, repo, ownerID, "second")
	id := uuid.NewString()

	if _, err := repo.SaveAnalysisMessage(testContext(t), ownerID, models.Message{
		ID:     id,
		ChatID: first.ID,
		Role:   models.RoleAssistant,
		Analysis: &models.Analysis{
			State:           models.StateRunning,
			Model:           models.ModelSpark,
			SourceMessageID: "m1",
		},
	}); err != nil {
		t.Fatalf("SaveAnalysisMessage: %v", err)
	}

	_, err := repo.SaveAnalysisMessage(testContext(t), ownerID, models.Message{
		ID:     id,
		ChatID: second.ID,
		Role:   models.RoleAssistant,
		Analysis: &models.Analysis{
			State:           models.StateRunning,
			Model:           models.ModelSpark,
			SourceMessageID: "m1",
		},
	})
	assertErrorIs(t, err, models.ErrNotFound)
}

func TestSaveAnalysisMessageRejectsAnotherOwner(t *testing.T) {
	repo := newRepository(t)
	chat := createChat(t, repo, owner(), "private")

	_, err := repo.SaveAnalysisMessage(testContext(t), owner(), models.Message{
		ID:     uuid.NewString(),
		ChatID: chat.ID,
		Role:   models.RoleAssistant,
		Analysis: &models.Analysis{
			State:           models.StateRunning,
			Model:           models.ModelSpark,
			SourceMessageID: "m1",
		},
	})
	assertErrorIs(t, err, models.ErrNotFound)
}

func TestChatHistoryPagesWithCursor(t *testing.T) {
	repo := newRepository(t)
	ownerID := owner()
	chat := createChat(t, repo, ownerID, "thread")
	base := time.Now().UTC().Truncate(time.Second)

	for i := range 5 {
		if _, err := repo.SaveUserMessage(testContext(t), ownerID, models.Message{
			ID:        uuid.NewString(),
			ChatID:    chat.ID,
			Role:      models.RoleUser,
			Content:   "message",
			CreatedAt: base.Add(time.Duration(i) * time.Second),
		}); err != nil {
			t.Fatalf("SaveUserMessage: %v", err)
		}
	}

	first, cursor, err := repo.ChatHistory(testContext(t), ownerID, chat.ID, "", 2)
	if err != nil {
		t.Fatalf("ChatHistory: %v", err)
	}
	if len(first) != 2 {
		t.Fatalf("first page = %d messages, want 2", len(first))
	}
	if cursor == "" {
		t.Fatal("cursor is empty, want the next page boundary")
	}

	second, cursor, err := repo.ChatHistory(testContext(t), ownerID, chat.ID, cursor, 2)
	if err != nil {
		t.Fatalf("ChatHistory: %v", err)
	}
	if len(second) != 2 {
		t.Fatalf("second page = %d messages, want 2", len(second))
	}

	last, cursor, err := repo.ChatHistory(testContext(t), ownerID, chat.ID, cursor, 2)
	if err != nil {
		t.Fatalf("ChatHistory: %v", err)
	}
	if len(last) != 1 {
		t.Fatalf("last page = %d messages, want 1", len(last))
	}
	if cursor != "" {
		t.Errorf("cursor = %q, want it empty at the end of history", cursor)
	}

	seen := make([]string, 0, 5)
	for _, page := range [][]models.Message{first, second, last} {
		for _, msg := range page {
			seen = append(seen, msg.CreatedAt.UTC().Format(time.RFC3339))
		}
	}
	want := []string{
		base.Add(4 * time.Second).Format(time.RFC3339),
		base.Add(3 * time.Second).Format(time.RFC3339),
		base.Add(2 * time.Second).Format(time.RFC3339),
		base.Add(1 * time.Second).Format(time.RFC3339),
		base.Format(time.RFC3339),
	}
	for i, stamp := range want {
		if seen[i] != stamp {
			t.Errorf("message %d at %q, want %q", i, seen[i], stamp)
		}
	}
}

func TestChatHistoryRejectsAMalformedCursor(t *testing.T) {
	repo := newRepository(t)
	ownerID := owner()
	chat := createChat(t, repo, ownerID, "thread")

	for _, cursor := range []string{"not base64!!", "bm90IGpzb24"} {
		_, _, err := repo.ChatHistory(testContext(t), ownerID, chat.ID, cursor, 10)
		assertErrorIs(t, err, models.ErrInvalidCursor)
	}
}

func TestChatHistoryRejectsAForeignCursor(t *testing.T) {
	repo := newRepository(t)
	ownerID := owner()
	first := createChat(t, repo, ownerID, "first")
	second := createChat(t, repo, ownerID, "second")

	if _, err := repo.SaveUserMessage(testContext(t), ownerID, models.Message{
		ID:      uuid.NewString(),
		ChatID:  first.ID,
		Role:    models.RoleUser,
		Content: "hello",
	}); err != nil {
		t.Fatalf("SaveUserMessage: %v", err)
	}
	if _, err := repo.SaveUserMessage(testContext(t), ownerID, models.Message{
		ID:      uuid.NewString(),
		ChatID:  first.ID,
		Role:    models.RoleUser,
		Content: "hello again",
	}); err != nil {
		t.Fatalf("SaveUserMessage: %v", err)
	}

	// A page short enough to leave the second message behind yields the cursor
	// the other chat must reject.
	_, cursor, err := repo.ChatHistory(testContext(t), ownerID, first.ID, "", 1)
	if err != nil {
		t.Fatalf("ChatHistory: %v", err)
	}
	if cursor == "" {
		t.Fatal("cursor is empty, want the next page boundary")
	}

	_, _, err = repo.ChatHistory(testContext(t), ownerID, second.ID, cursor, 10)
	assertErrorIs(t, err, models.ErrInvalidCursor)
}

func TestChatHistoryRejectsAnotherOwner(t *testing.T) {
	repo := newRepository(t)
	chat := createChat(t, repo, owner(), "private")

	_, _, err := repo.ChatHistory(testContext(t), owner(), chat.ID, "", 10)
	assertErrorIs(t, err, models.ErrNotFound)
}

// indexKeys lists one collection's indexes through a raw inspector connection,
// keyed by the "field:direction" signature of each index.
func indexKeys(t *testing.T, collection string) map[string]bool {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	inspector, err := driver.Connect(options.Client().
		ApplyURI(support.Mongo(t).URI).
		SetConnectTimeout(5 * time.Second).
		SetServerSelectionTimeout(5 * time.Second))
	if err != nil {
		t.Fatalf("inspector connect: %v", err)
	}
	defer func() {
		disCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = inspector.Disconnect(disCtx)
	}()

	cursor, err := inspector.Database(testDatabase).Collection(collection).Indexes().List(ctx)
	if err != nil {
		t.Fatalf("list indexes on %s: %v", collection, err)
	}
	defer cursor.Close(ctx)

	keys := make(map[string]bool)
	for cursor.Next(ctx) {
		var spec bson.D
		if err := cursor.Decode(&spec); err != nil {
			t.Fatalf("decode index spec: %v", err)
		}
		for _, el := range spec {
			if el.Key != "key" {
				continue
			}
			if doc, ok := el.Value.(bson.D); ok {
				keys[keysSignature(doc)] = true
			}
		}
	}
	if err := cursor.Err(); err != nil {
		t.Fatalf("iterate indexes on %s: %v", collection, err)
	}
	return keys
}

func keysSignature(keys bson.D) string {
	parts := make([]string, 0, len(keys))
	for _, el := range keys {
		parts = append(parts, fmt.Sprintf("%s:%v", el.Key, el.Value))
	}
	return strings.Join(parts, ",")
}
