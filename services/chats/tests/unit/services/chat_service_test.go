// Package services_test drives the chats service layer over fake data access and a fake cache.
package services_test

import (
	"context"
	"errors"
	"log/slog"
	"slices"
	"testing"
	"time"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/cache"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/models"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/repository"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/services"
)

// fakeRepository records the calls the service makes and answers from the
// function fields a test sets.
type fakeRepository struct {
	createChat          func(ctx context.Context, ownerID, title string) (models.Chat, error)
	chat                func(ctx context.Context, ownerID, chatID string) (models.Chat, error)
	chats               func(ctx context.Context, ownerID string, limit int) ([]models.ChatSummary, error)
	renameChat          func(ctx context.Context, ownerID, chatID, title string) (models.ChatSummary, error)
	deleteChat          func(ctx context.Context, ownerID, chatID string) error
	saveUserMessage     func(ctx context.Context, ownerID string, msg models.Message) (models.Message, error)
	saveAnalysisMessage func(ctx context.Context, ownerID string, msg models.Message) (models.Message, error)
	chatHistory         func(ctx context.Context, ownerID, chatID, cursor string, limit int) ([]models.Message, string, error)

	calls []string
}

func (f *fakeRepository) CreateChat(ctx context.Context, ownerID, title string) (models.Chat, error) {
	f.calls = append(f.calls, "CreateChat")
	if f.createChat == nil {
		return models.Chat{}, nil
	}
	return f.createChat(ctx, ownerID, title)
}

func (f *fakeRepository) Chat(ctx context.Context, ownerID, chatID string) (models.Chat, error) {
	f.calls = append(f.calls, "Chat")
	if f.chat == nil {
		return models.Chat{}, models.ErrNotFound
	}
	return f.chat(ctx, ownerID, chatID)
}

func (f *fakeRepository) Chats(ctx context.Context, ownerID string, limit int) ([]models.ChatSummary, error) {
	f.calls = append(f.calls, "Chats")
	if f.chats == nil {
		return nil, nil
	}
	return f.chats(ctx, ownerID, limit)
}

func (f *fakeRepository) RenameChat(ctx context.Context, ownerID, chatID, title string) (models.ChatSummary, error) {
	f.calls = append(f.calls, "RenameChat")
	if f.renameChat == nil {
		return models.ChatSummary{}, nil
	}
	return f.renameChat(ctx, ownerID, chatID, title)
}

func (f *fakeRepository) DeleteChat(ctx context.Context, ownerID, chatID string) error {
	f.calls = append(f.calls, "DeleteChat")
	if f.deleteChat == nil {
		return nil
	}
	return f.deleteChat(ctx, ownerID, chatID)
}

func (f *fakeRepository) SaveUserMessage(ctx context.Context, ownerID string, msg models.Message) (models.Message, error) {
	f.calls = append(f.calls, "SaveUserMessage")
	if f.saveUserMessage == nil {
		return msg, nil
	}
	return f.saveUserMessage(ctx, ownerID, msg)
}

func (f *fakeRepository) SaveAnalysisMessage(ctx context.Context, ownerID string, msg models.Message) (models.Message, error) {
	f.calls = append(f.calls, "SaveAnalysisMessage")
	if f.saveAnalysisMessage == nil {
		return msg, nil
	}
	return f.saveAnalysisMessage(ctx, ownerID, msg)
}

func (f *fakeRepository) ChatHistory(ctx context.Context, ownerID, chatID, cursor string, limit int) ([]models.Message, string, error) {
	f.calls = append(f.calls, "ChatHistory")
	if f.chatHistory == nil {
		return nil, "", nil
	}
	return f.chatHistory(ctx, ownerID, chatID, cursor, limit)
}

// countOf counts how often the service called one repository method.
func countOf(calls []string, name string) int {
	total := 0
	for _, call := range calls {
		if call == name {
			total++
		}
	}
	return total
}

// fakeCache is an in-memory cache plane that can be told to fail.
type fakeCache struct {
	chats map[string]models.Chat
	lists map[string][]models.ChatSummary
	heads map[string]models.Page

	readErr  error
	writeErr error

	invalidated []string
}

func newFakeCache() *fakeCache {
	return &fakeCache{
		chats: map[string]models.Chat{},
		lists: map[string][]models.ChatSummary{},
		heads: map[string]models.Page{},
	}
}

func (f *fakeCache) Chat(_ context.Context, chatID string) (models.Chat, bool, error) {
	if f.readErr != nil {
		return models.Chat{}, false, f.readErr
	}
	chat, ok := f.chats[chatID]
	return chat, ok, nil
}

func (f *fakeCache) PutChat(_ context.Context, chat models.Chat) error {
	if f.writeErr != nil {
		return f.writeErr
	}
	f.chats[chat.ID] = chat
	return nil
}

func (f *fakeCache) ChatList(_ context.Context, ownerID string) ([]models.ChatSummary, bool, error) {
	if f.readErr != nil {
		return nil, false, f.readErr
	}
	chats, ok := f.lists[ownerID]
	return chats, ok, nil
}

func (f *fakeCache) PutChatList(_ context.Context, ownerID string, chats []models.ChatSummary) error {
	if f.writeErr != nil {
		return f.writeErr
	}
	f.lists[ownerID] = chats
	return nil
}

func (f *fakeCache) Head(_ context.Context, chatID string) (models.Page, bool, error) {
	if f.readErr != nil {
		return models.Page{}, false, f.readErr
	}
	page, ok := f.heads[chatID]
	return page, ok, nil
}

func (f *fakeCache) PutHead(_ context.Context, chatID string, page models.Page) error {
	if f.writeErr != nil {
		return f.writeErr
	}
	f.heads[chatID] = page
	return nil
}

func (f *fakeCache) InvalidateMeta(_ context.Context, chatID string) error {
	if f.writeErr != nil {
		return f.writeErr
	}
	delete(f.chats, chatID)
	f.invalidated = append(f.invalidated, "meta:"+chatID)
	return nil
}

func (f *fakeCache) InvalidateChat(_ context.Context, chatID string) error {
	if f.writeErr != nil {
		return f.writeErr
	}
	delete(f.chats, chatID)
	delete(f.heads, chatID)
	f.invalidated = append(f.invalidated, "chat:"+chatID)
	return nil
}

func (f *fakeCache) InvalidateOwner(_ context.Context, ownerID string) error {
	if f.writeErr != nil {
		return f.writeErr
	}
	delete(f.lists, ownerID)
	f.invalidated = append(f.invalidated, "owner:"+ownerID)
	return nil
}

func newService(repo repository.Repository, entries cache.Cache) *services.ChatService {
	return services.NewChatService(repo, entries, slog.New(slog.DiscardHandler))
}

func TestCreateChatDerivesTheTitleAndStoresTheFirstMessage(t *testing.T) {
	var savedTitle string
	var savedMessage models.Message
	repo := &fakeRepository{
		createChat: func(_ context.Context, ownerID, title string) (models.Chat, error) {
			savedTitle = title
			return models.Chat{ID: "chat-1", UserID: ownerID, Title: title}, nil
		},
		saveUserMessage: func(_ context.Context, _ string, msg models.Message) (models.Message, error) {
			savedMessage = msg
			return msg, nil
		},
	}
	entries := newFakeCache()
	service := newService(repo, entries)

	chat, err := service.CreateChat(context.Background(), "owner-1", "  how does the cursor work?  ")
	if err != nil {
		t.Fatalf("CreateChat: %v", err)
	}
	if savedTitle != "how does the cursor work?" {
		t.Errorf("title = %q, want the trimmed initial message", savedTitle)
	}
	if savedMessage.ChatID != "chat-1" {
		t.Errorf("first message chat = %q, want %q", savedMessage.ChatID, "chat-1")
	}
	if savedMessage.Content != "  how does the cursor work?  " {
		t.Errorf("first message content = %q, want the original message", savedMessage.Content)
	}
	if chat.ID != "chat-1" {
		t.Errorf("chat id = %q, want %q", chat.ID, "chat-1")
	}
	if !slices.Contains(entries.invalidated, "owner:owner-1") {
		t.Errorf("invalidated = %v, want the owner's list dropped", entries.invalidated)
	}
}

func TestCreateChatRejectsAnEmptyMessage(t *testing.T) {
	repo := &fakeRepository{}
	service := newService(repo, newFakeCache())

	_, err := service.CreateChat(context.Background(), "owner-1", "   ")
	var validation *services.ValidationError
	if !errors.As(err, &validation) {
		t.Fatalf("err = %v, want a validation error", err)
	}
	if len(repo.calls) != 0 {
		t.Errorf("repository calls = %v, want none", repo.calls)
	}
}

func TestGetChatServesTheSecondCallFromTheCache(t *testing.T) {
	repo := &fakeRepository{
		chat: func(_ context.Context, ownerID, chatID string) (models.Chat, error) {
			return models.Chat{ID: chatID, UserID: ownerID, Title: "a title"}, nil
		},
		chatHistory: func(_ context.Context, _ string, chatID, _ string, _ int) ([]models.Message, string, error) {
			return []models.Message{{ID: "m1", ChatID: chatID, Role: models.RoleUser, Content: "hello"}}, "cursor-1", nil
		},
	}
	service := newService(repo, newFakeCache())

	chat, messages, cursor, err := service.GetChat(context.Background(), "owner-1", "chat-1")
	if err != nil {
		t.Fatalf("GetChat: %v", err)
	}
	if chat.Title != "a title" {
		t.Errorf("title = %q, want %q", chat.Title, "a title")
	}
	if len(messages) != 1 || messages[0].Content != "hello" {
		t.Errorf("messages = %+v, want the head page", messages)
	}
	if cursor != "cursor-1" {
		t.Errorf("cursor = %q, want %q", cursor, "cursor-1")
	}

	if _, _, _, err := service.GetChat(context.Background(), "owner-1", "chat-1"); err != nil {
		t.Fatalf("GetChat: %v", err)
	}
	if calls := countOf(repo.calls, "Chat"); calls != 1 {
		t.Errorf("chat reads = %d, want 1; the second call came from the cache", calls)
	}
	if calls := countOf(repo.calls, "ChatHistory"); calls != 1 {
		t.Errorf("history reads = %d, want 1; the second call came from the cache", calls)
	}
}

func TestGetChatRejectsAnotherOwnerOnACacheHit(t *testing.T) {
	repo := &fakeRepository{}
	entries := newFakeCache()
	entries.chats["chat-1"] = models.Chat{ID: "chat-1", UserID: "owner-2", Title: "private"}
	service := newService(repo, entries)

	_, _, _, err := service.GetChat(context.Background(), "owner-1", "chat-1")
	if !errors.Is(err, models.ErrNotFound) {
		t.Fatalf("err = %v, want %v", err, models.ErrNotFound)
	}
	if len(repo.calls) != 0 {
		t.Errorf("repository calls = %v, want none", repo.calls)
	}
}

func TestListChatsTrimsToTheLimit(t *testing.T) {
	repo := &fakeRepository{
		chats: func(_ context.Context, _ string, _ int) ([]models.ChatSummary, error) {
			return []models.ChatSummary{{ID: "c1"}, {ID: "c2"}, {ID: "c3"}}, nil
		},
	}
	service := newService(repo, newFakeCache())

	summaries, err := service.ListChats(context.Background(), "owner-1", 2)
	if err != nil {
		t.Fatalf("ListChats: %v", err)
	}
	if len(summaries) != 2 {
		t.Fatalf("summaries = %d, want 2", len(summaries))
	}
	if summaries[0].ID != "c1" {
		t.Errorf("first summary = %q, want %q", summaries[0].ID, "c1")
	}

	if _, err := service.ListChats(context.Background(), "owner-1", 2); err != nil {
		t.Fatalf("ListChats: %v", err)
	}
	if calls := countOf(repo.calls, "Chats"); calls != 1 {
		t.Errorf("list reads = %d, want 1; the second call came from the cache", calls)
	}
}

func TestRenameChatInvalidatesTheMetaAndTheOwnerList(t *testing.T) {
	repo := &fakeRepository{
		renameChat: func(_ context.Context, _ string, chatID, title string) (models.ChatSummary, error) {
			return models.ChatSummary{ID: chatID, Title: title}, nil
		},
	}
	entries := newFakeCache()
	entries.chats["chat-1"] = models.Chat{ID: "chat-1", UserID: "owner-1"}
	entries.heads["chat-1"] = models.Page{Messages: []models.Message{{ID: "m1"}}}
	service := newService(repo, entries)

	if _, err := service.RenameChat(context.Background(), "owner-1", "chat-1", "a new title"); err != nil {
		t.Fatalf("RenameChat: %v", err)
	}
	if _, ok := entries.chats["chat-1"]; ok {
		t.Error("the chat meta survived, want it dropped")
	}
	if _, ok := entries.heads["chat-1"]; !ok {
		t.Error("the head page was dropped, want it to survive a rename")
	}
	if !slices.Contains(entries.invalidated, "owner:owner-1") {
		t.Errorf("invalidated = %v, want the owner's list dropped", entries.invalidated)
	}
}

func TestRenameChatRejectsAnEmptyTitle(t *testing.T) {
	repo := &fakeRepository{}
	service := newService(repo, newFakeCache())

	_, err := service.RenameChat(context.Background(), "owner-1", "chat-1", "  ")
	var validation *services.ValidationError
	if !errors.As(err, &validation) {
		t.Fatalf("err = %v, want a validation error", err)
	}
	if len(repo.calls) != 0 {
		t.Errorf("repository calls = %v, want none", repo.calls)
	}
}

func TestDeleteChatInvalidatesTheChatAndTheOwnerList(t *testing.T) {
	repo := &fakeRepository{}
	entries := newFakeCache()
	entries.chats["chat-1"] = models.Chat{ID: "chat-1", UserID: "owner-1"}
	entries.heads["chat-1"] = models.Page{Messages: []models.Message{{ID: "m1"}}}
	service := newService(repo, entries)

	if err := service.DeleteChat(context.Background(), "owner-1", "chat-1"); err != nil {
		t.Fatalf("DeleteChat: %v", err)
	}
	if _, ok := entries.heads["chat-1"]; ok {
		t.Error("the head page survived, want it dropped")
	}
	if !slices.Contains(entries.invalidated, "chat:chat-1") {
		t.Errorf("invalidated = %v, want the chat dropped", entries.invalidated)
	}
	if !slices.Contains(entries.invalidated, "owner:owner-1") {
		t.Errorf("invalidated = %v, want the owner's list dropped", entries.invalidated)
	}
}

func TestSaveUserMessageValidatesAndInvalidates(t *testing.T) {
	repo := &fakeRepository{}
	entries := newFakeCache()
	service := newService(repo, entries)

	if _, err := service.SaveUserMessage(context.Background(), "owner-1", "chat-1", "m1", "", time.Time{}); err == nil {
		t.Fatal("SaveUserMessage = nil error, want a validation failure")
	}
	if len(repo.calls) != 0 {
		t.Errorf("repository calls = %v, want none", repo.calls)
	}

	if _, err := service.SaveUserMessage(context.Background(), "owner-1", "chat-1", "m1", "hello", time.Time{}); err != nil {
		t.Fatalf("SaveUserMessage: %v", err)
	}
	if !slices.Contains(entries.invalidated, "chat:chat-1") {
		t.Errorf("invalidated = %v, want the chat dropped", entries.invalidated)
	}
}

func TestSaveAnalysisMessageRejectsACompletionWithoutAResult(t *testing.T) {
	repo := &fakeRepository{}
	service := newService(repo, newFakeCache())

	_, err := service.SaveAnalysisMessage(context.Background(), "owner-1", "chat-1", "a1", time.Time{}, &models.Analysis{
		State:           models.StateCompleted,
		Model:           models.ModelSpark,
		SourceMessageID: "m1",
	})
	var validation *services.ValidationError
	if !errors.As(err, &validation) {
		t.Fatalf("err = %v, want a validation error", err)
	}
	if len(repo.calls) != 0 {
		t.Errorf("repository calls = %v, want none", repo.calls)
	}
}

func TestSaveAnalysisMessageInvalidatesTheChat(t *testing.T) {
	repo := &fakeRepository{}
	entries := newFakeCache()
	service := newService(repo, entries)

	if _, err := service.SaveAnalysisMessage(context.Background(), "owner-1", "chat-1", "a1", time.Time{}, &models.Analysis{
		State:           models.StateRunning,
		Model:           models.ModelSpark,
		SourceMessageID: "m1",
	}); err != nil {
		t.Fatalf("SaveAnalysisMessage: %v", err)
	}
	if !slices.Contains(entries.invalidated, "chat:chat-1") {
		t.Errorf("invalidated = %v, want the chat dropped", entries.invalidated)
	}
}

func TestGetChatHistoryCachesTheFirstPageAndBypassesTheCacheForCursorPages(t *testing.T) {
	repo := &fakeRepository{
		chat: func(_ context.Context, ownerID, chatID string) (models.Chat, error) {
			return models.Chat{ID: chatID, UserID: ownerID}, nil
		},
		chatHistory: func(_ context.Context, _ string, chatID, cursor string, _ int) ([]models.Message, string, error) {
			if cursor != "" {
				return []models.Message{{ID: "m3", ChatID: chatID}}, "cursor-2", nil
			}
			return []models.Message{{ID: "m1", ChatID: chatID}}, "cursor-1", nil
		},
	}
	service := newService(repo, newFakeCache())

	messages, cursor, err := service.GetChatHistory(context.Background(), "owner-1", "chat-1", "", 10)
	if err != nil {
		t.Fatalf("GetChatHistory: %v", err)
	}
	if len(messages) != 1 || messages[0].ID != "m1" {
		t.Errorf("messages = %+v, want the first page", messages)
	}
	if cursor != "cursor-1" {
		t.Errorf("cursor = %q, want %q", cursor, "cursor-1")
	}

	if _, _, err := service.GetChatHistory(context.Background(), "owner-1", "chat-1", "", 10); err != nil {
		t.Fatalf("GetChatHistory: %v", err)
	}
	if calls := countOf(repo.calls, "ChatHistory"); calls != 1 {
		t.Errorf("history reads = %d, want 1; the second first page came from the cache", calls)
	}

	if _, cursor, err := service.GetChatHistory(context.Background(), "owner-1", "chat-1", "cursor-1", 10); err != nil {
		t.Fatalf("GetChatHistory: %v", err)
	} else if cursor != "cursor-2" {
		t.Errorf("cursor = %q, want %q", cursor, "cursor-2")
	}
	if calls := countOf(repo.calls, "ChatHistory"); calls != 2 {
		t.Errorf("history reads = %d, want 2; a cursor page reads the source", calls)
	}
}

func TestGetChatHistoryTrimsTheCachedPageAndDerivesItsCursor(t *testing.T) {
	repo := &fakeRepository{
		chat: func(_ context.Context, ownerID, chatID string) (models.Chat, error) {
			return models.Chat{ID: chatID, UserID: ownerID}, nil
		},
		chatHistory: func(_ context.Context, _ string, chatID, _ string, _ int) ([]models.Message, string, error) {
			return []models.Message{
				{ID: "m3", ChatID: chatID, CreatedAt: time.Date(2026, 1, 2, 3, 0, 3, 0, time.UTC)},
				{ID: "m2", ChatID: chatID, CreatedAt: time.Date(2026, 1, 2, 3, 0, 2, 0, time.UTC)},
				{ID: "m1", ChatID: chatID, CreatedAt: time.Date(2026, 1, 2, 3, 0, 1, 0, time.UTC)},
			}, "cursor-at-m1", nil
		},
	}
	service := newService(repo, newFakeCache())

	messages, cursor, err := service.GetChatHistory(context.Background(), "owner-1", "chat-1", "", 2)
	if err != nil {
		t.Fatalf("GetChatHistory: %v", err)
	}
	if len(messages) != 2 {
		t.Fatalf("messages = %d, want 2", len(messages))
	}
	if messages[0].ID != "m3" || messages[1].ID != "m2" {
		t.Errorf("messages = %+v, want the newest two", messages)
	}
	if cursor == "cursor-at-m1" {
		t.Error("cursor = the full page's cursor, want one that chains to the trimmed page")
	}
	if cursor == "" {
		t.Error("cursor is empty, want one that chains to the trimmed page")
	}
}

func TestACacheReadFaultDegradesToTheRepository(t *testing.T) {
	repo := &fakeRepository{
		chat: func(_ context.Context, ownerID, chatID string) (models.Chat, error) {
			return models.Chat{ID: chatID, UserID: ownerID, Title: "a title"}, nil
		},
		chatHistory: func(_ context.Context, _ string, chatID, _ string, _ int) ([]models.Message, string, error) {
			return []models.Message{{ID: "m1", ChatID: chatID}}, "", nil
		},
	}
	entries := newFakeCache()
	entries.readErr = errors.New("redis is down")
	service := newService(repo, entries)

	chat, messages, _, err := service.GetChat(context.Background(), "owner-1", "chat-1")
	if err != nil {
		t.Fatalf("GetChat: %v", err)
	}
	if chat.Title != "a title" {
		t.Errorf("title = %q, want %q", chat.Title, "a title")
	}
	if len(messages) != 1 {
		t.Errorf("messages = %+v, want the head page from the repository", messages)
	}
}

func TestACacheInvalidationFaultIsAbsorbed(t *testing.T) {
	repo := &fakeRepository{}
	entries := newFakeCache()
	entries.writeErr = errors.New("redis is down")
	service := newService(repo, entries)

	if err := service.DeleteChat(context.Background(), "owner-1", "chat-1"); err != nil {
		t.Fatalf("DeleteChat: %v", err)
	}
}
