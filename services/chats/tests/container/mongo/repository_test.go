// Package mongo_test drives the repository against the local compose mongo.
package mongo_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"go.mongodb.org/mongo-driver/v2/bson"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/repository"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/services"
)

// owner returns an identity no other test shares.
func owner() string {
	return "owner-" + uuid.NewString()
}

func newRepository(t *testing.T) *repository.Repository {
	t.Helper()
	return repository.New(connectLocal(t).Database())
}

func testContext(t *testing.T) context.Context {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	t.Cleanup(cancel)
	return ctx
}

func createChat(t *testing.T, repo *repository.Repository, ownerID, title string) services.Chat {
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
	count, err := connectLocal(t).Database().
		Collection("messages").
		CountDocuments(testContext(t), bson.M{"chat_id": chatID})
	if err != nil {
		t.Fatalf("CountDocuments: %v", err)
	}
	return count
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
	assertErrorIs(t, err, services.ErrNotFound)
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
	assertErrorIs(t, err, services.ErrNotFound)
}

func TestDeleteChatRemovesChatAndMessages(t *testing.T) {
	repo := newRepository(t)
	ownerID := owner()
	chat := createChat(t, repo, ownerID, "doomed")
	_, err := repo.SaveUserMessage(testContext(t), ownerID, services.Message{
		ID:      uuid.NewString(),
		ChatID:  chat.ID,
		Role:    services.RoleUser,
		Content: "hello",
	})
	if err != nil {
		t.Fatalf("SaveUserMessage: %v", err)
	}

	if err := repo.DeleteChat(testContext(t), ownerID, chat.ID); err != nil {
		t.Fatalf("DeleteChat: %v", err)
	}

	_, err = repo.Chat(testContext(t), ownerID, chat.ID)
	assertErrorIs(t, err, services.ErrNotFound)
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
	assertErrorIs(t, err, services.ErrNotFound)

	if _, err := repo.Chat(testContext(t), ownerID, chat.ID); err != nil {
		t.Fatalf("Chat after the rejected delete: %v", err)
	}
}

func TestSaveUserMessageStoresTheMessage(t *testing.T) {
	repo := newRepository(t)
	ownerID := owner()
	chat := createChat(t, repo, ownerID, "thread")

	saved, err := repo.SaveUserMessage(testContext(t), ownerID, services.Message{
		ID:      uuid.NewString(),
		ChatID:  chat.ID,
		Role:    services.RoleUser,
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

	first, err := repo.SaveUserMessage(testContext(t), ownerID, services.Message{
		ID:      id,
		ChatID:  chat.ID,
		Role:    services.RoleUser,
		Content: "the original",
	})
	if err != nil {
		t.Fatalf("SaveUserMessage: %v", err)
	}

	replay, err := repo.SaveUserMessage(testContext(t), ownerID, services.Message{
		ID:      id,
		ChatID:  chat.ID,
		Role:    services.RoleUser,
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

	_, err := repo.SaveUserMessage(testContext(t), ownerID, services.Message{
		ID:      id,
		ChatID:  first.ID,
		Role:    services.RoleUser,
		Content: "hello",
	})
	if err != nil {
		t.Fatalf("SaveUserMessage: %v", err)
	}

	_, err = repo.SaveUserMessage(testContext(t), ownerID, services.Message{
		ID:      id,
		ChatID:  second.ID,
		Role:    services.RoleUser,
		Content: "hello",
	})
	assertErrorIs(t, err, services.ErrNotFound)
}

func TestSaveUserMessageRejectsAnotherOwner(t *testing.T) {
	repo := newRepository(t)
	chat := createChat(t, repo, owner(), "private")

	_, err := repo.SaveUserMessage(testContext(t), owner(), services.Message{
		ID:      uuid.NewString(),
		ChatID:  chat.ID,
		Role:    services.RoleUser,
		Content: "hello",
	})
	assertErrorIs(t, err, services.ErrNotFound)
}

func TestSaveUserMessageBumpsTheSidebarOrder(t *testing.T) {
	repo := newRepository(t)
	ownerID := owner()
	quiet := createChat(t, repo, ownerID, "quiet")
	time.Sleep(2 * time.Millisecond)
	busy := createChat(t, repo, ownerID, "busy")

	time.Sleep(2 * time.Millisecond)
	if _, err := repo.SaveUserMessage(testContext(t), ownerID, services.Message{
		ID:      uuid.NewString(),
		ChatID:  quiet.ID,
		Role:    services.RoleUser,
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

	running, err := repo.SaveAnalysisMessage(testContext(t), ownerID, services.Message{
		ID:     id,
		ChatID: chat.ID,
		Role:   services.RoleAssistant,
		Analysis: &services.Analysis{
			State:           services.StateRunning,
			Model:           services.ModelSpark,
			SourceMessageID: "m1",
		},
	})
	if err != nil {
		t.Fatalf("SaveAnalysisMessage: %v", err)
	}
	if running.Analysis == nil || running.Analysis.State != services.StateRunning {
		t.Fatalf("analysis = %+v, want the running state", running.Analysis)
	}

	completed, err := repo.SaveAnalysisMessage(testContext(t), ownerID, services.Message{
		ID:     id,
		ChatID: chat.ID,
		Role:   services.RoleAssistant,
		Analysis: &services.Analysis{
			State:           services.StateCompleted,
			Model:           services.ModelSpark,
			SourceMessageID: "m1",
			Result: &services.AnalysisResult{
				Label:      services.LabelAI,
				Confidence: 0.9,
				Scores:     services.Scores{AI: 0.9, Human: 0.1},
				Highlights: []services.Highlight{{CharStart: 0, CharEnd: 4, AIConfidence: 0.8, Label: services.LabelAI}},
				Raw:        map[string]any{"nested": map[string]any{"score": 0.5}},
			},
		},
	})
	if err != nil {
		t.Fatalf("SaveAnalysisMessage: %v", err)
	}
	if completed.Analysis == nil || completed.Analysis.State != services.StateCompleted {
		t.Fatalf("analysis = %+v, want the completed state", completed.Analysis)
	}
	if completed.Analysis.Result == nil || completed.Analysis.Result.Label != services.LabelAI {
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
	failed := &services.Analysis{
		State:           services.StateFailed,
		Model:           services.ModelSpark,
		SourceMessageID: "m1",
		Error:           "inference timeout",
	}

	if _, err := repo.SaveAnalysisMessage(testContext(t), ownerID, services.Message{
		ID:       id,
		ChatID:   chat.ID,
		Role:     services.RoleAssistant,
		Analysis: failed,
	}); err != nil {
		t.Fatalf("SaveAnalysisMessage: %v", err)
	}

	replay, err := repo.SaveAnalysisMessage(testContext(t), ownerID, services.Message{
		ID:       id,
		ChatID:   chat.ID,
		Role:     services.RoleAssistant,
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

	if _, err := repo.SaveAnalysisMessage(testContext(t), ownerID, services.Message{
		ID:     id,
		ChatID: chat.ID,
		Role:   services.RoleAssistant,
		Analysis: &services.Analysis{
			State:           services.StateCompleted,
			Model:           services.ModelSpark,
			SourceMessageID: "m1",
			Result: &services.AnalysisResult{
				Label:      services.LabelAI,
				Confidence: 0.9,
				Scores:     services.Scores{AI: 0.9, Human: 0.1},
			},
		},
	}); err != nil {
		t.Fatalf("SaveAnalysisMessage: %v", err)
	}

	_, err := repo.SaveAnalysisMessage(testContext(t), ownerID, services.Message{
		ID:     id,
		ChatID: chat.ID,
		Role:   services.RoleAssistant,
		Analysis: &services.Analysis{
			State:           services.StateCompleted,
			Model:           services.ModelSpark,
			SourceMessageID: "m1",
			Result: &services.AnalysisResult{
				Label:      services.LabelHuman,
				Confidence: 0.2,
				Scores:     services.Scores{AI: 0.2, Human: 0.8},
			},
		},
	})
	assertErrorIs(t, err, services.ErrConflict)
}

func TestSaveAnalysisMessageRejectsMessageBoundToAnotherChat(t *testing.T) {
	repo := newRepository(t)
	ownerID := owner()
	first := createChat(t, repo, ownerID, "first")
	second := createChat(t, repo, ownerID, "second")
	id := uuid.NewString()

	if _, err := repo.SaveAnalysisMessage(testContext(t), ownerID, services.Message{
		ID:     id,
		ChatID: first.ID,
		Role:   services.RoleAssistant,
		Analysis: &services.Analysis{
			State:           services.StateRunning,
			Model:           services.ModelSpark,
			SourceMessageID: "m1",
		},
	}); err != nil {
		t.Fatalf("SaveAnalysisMessage: %v", err)
	}

	_, err := repo.SaveAnalysisMessage(testContext(t), ownerID, services.Message{
		ID:     id,
		ChatID: second.ID,
		Role:   services.RoleAssistant,
		Analysis: &services.Analysis{
			State:           services.StateRunning,
			Model:           services.ModelSpark,
			SourceMessageID: "m1",
		},
	})
	assertErrorIs(t, err, services.ErrNotFound)
}

func TestSaveAnalysisMessageRejectsAnotherOwner(t *testing.T) {
	repo := newRepository(t)
	chat := createChat(t, repo, owner(), "private")

	_, err := repo.SaveAnalysisMessage(testContext(t), owner(), services.Message{
		ID:     uuid.NewString(),
		ChatID: chat.ID,
		Role:   services.RoleAssistant,
		Analysis: &services.Analysis{
			State:           services.StateRunning,
			Model:           services.ModelSpark,
			SourceMessageID: "m1",
		},
	})
	assertErrorIs(t, err, services.ErrNotFound)
}

func TestChatHistoryPagesWithCursor(t *testing.T) {
	repo := newRepository(t)
	ownerID := owner()
	chat := createChat(t, repo, ownerID, "thread")
	base := time.Now().UTC().Truncate(time.Second)

	for i := range 5 {
		if _, err := repo.SaveUserMessage(testContext(t), ownerID, services.Message{
			ID:        uuid.NewString(),
			ChatID:    chat.ID,
			Role:      services.RoleUser,
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
	for _, page := range [][]services.Message{first, second, last} {
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
		assertErrorIs(t, err, services.ErrInvalidCursor)
	}
}

func TestChatHistoryRejectsAForeignCursor(t *testing.T) {
	repo := newRepository(t)
	ownerID := owner()
	first := createChat(t, repo, ownerID, "first")
	second := createChat(t, repo, ownerID, "second")

	if _, err := repo.SaveUserMessage(testContext(t), ownerID, services.Message{
		ID:      uuid.NewString(),
		ChatID:  first.ID,
		Role:    services.RoleUser,
		Content: "hello",
	}); err != nil {
		t.Fatalf("SaveUserMessage: %v", err)
	}
	if _, err := repo.SaveUserMessage(testContext(t), ownerID, services.Message{
		ID:      uuid.NewString(),
		ChatID:  first.ID,
		Role:    services.RoleUser,
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
	assertErrorIs(t, err, services.ErrInvalidCursor)
}

func TestChatHistoryRejectsAnotherOwner(t *testing.T) {
	repo := newRepository(t)
	chat := createChat(t, repo, owner(), "private")

	_, _, err := repo.ChatHistory(testContext(t), owner(), chat.ID, "", 10)
	assertErrorIs(t, err, services.ErrNotFound)
}
