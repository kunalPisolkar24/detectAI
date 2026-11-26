package services_test

import (
	"context"
	"log/slog"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/cache/lock"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/models"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/observability"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/services"
)

type passthroughCoalescer struct{}

func (passthroughCoalescer) Do(ctx context.Context, _ string, fn func(context.Context) (any, error)) (any, error) {
	return fn(ctx)
}

type singleHolderLocker struct {
	mu   sync.Mutex
	held map[string]bool
}

func newSingleHolderLocker() *singleHolderLocker {
	return &singleHolderLocker{held: map[string]bool{}}
}

func (l *singleHolderLocker) Acquire(_ context.Context, key string, _ time.Duration) (string, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.held[key] {
		return "", lock.ErrLockHeld
	}
	l.held[key] = true
	return key, nil
}

func (l *singleHolderLocker) Release(_ context.Context, key, _ string) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.held, key)
	return nil
}

type stampedeCache struct {
	mu     sync.Mutex
	chats  map[string]models.Chat
	misses map[string]bool
}

func (c *stampedeCache) Chat(_ context.Context, chatID string) (models.Chat, bool, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	chat, ok := c.chats[chatID]
	return chat, ok, nil
}

func (c *stampedeCache) PutChat(_ context.Context, chat models.Chat) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.chats[chat.ID] = chat
	return nil
}

func (c *stampedeCache) ChatList(context.Context, string) ([]models.ChatSummary, bool, error) {
	return nil, false, nil
}
func (c *stampedeCache) PutChatList(context.Context, string, []models.ChatSummary) error {
	return nil
}
func (c *stampedeCache) Head(context.Context, string) (models.Page, bool, error) {
	return models.Page{}, false, nil
}
func (c *stampedeCache) PutHead(context.Context, string, models.Page) error { return nil }
func (c *stampedeCache) InvalidateMeta(context.Context, string) error       { return nil }
func (c *stampedeCache) InvalidateChat(context.Context, string) error       { return nil }
func (c *stampedeCache) InvalidateOwner(context.Context, string) error      { return nil }

func (c *stampedeCache) Missing(_ context.Context, ownerID, chatID string) (bool, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.misses[ownerID+":"+chatID], nil
}

func (c *stampedeCache) MarkMissing(_ context.Context, ownerID, chatID string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.misses[ownerID+":"+chatID] = true
	return nil
}

func (c *stampedeCache) ClearMissing(_ context.Context, ownerID, chatID string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.misses, ownerID+":"+chatID)
	return nil
}

type stampedeRepo struct {
	chats atomic.Int32
}

func (r *stampedeRepo) Chat(_ context.Context, ownerID, chatID string) (models.Chat, error) {
	r.chats.Add(1)
	time.Sleep(20 * time.Millisecond)
	return models.Chat{ID: chatID, UserID: ownerID, Title: "filled"}, nil
}

func (r *stampedeRepo) CreateChat(context.Context, string, string) (models.Chat, error) {
	return models.Chat{}, nil
}
func (r *stampedeRepo) Chats(context.Context, string, int) ([]models.ChatSummary, error) {
	return nil, nil
}
func (r *stampedeRepo) RenameChat(context.Context, string, string, string) (models.ChatSummary, error) {
	return models.ChatSummary{}, nil
}
func (r *stampedeRepo) DeleteChat(context.Context, string, string) error { return nil }
func (r *stampedeRepo) SaveUserMessage(context.Context, string, models.Message) (models.Message, error) {
	return models.Message{}, nil
}
func (r *stampedeRepo) SaveAnalysisMessage(context.Context, string, models.Message) (models.Message, error) {
	return models.Message{}, nil
}
func (r *stampedeRepo) ChatHistory(context.Context, string, string, string, int) ([]models.Message, string, error) {
	return nil, "", nil
}

func TestConcurrentColdReadsFetchTheSourceOnce(t *testing.T) {
	repo := &stampedeRepo{}
	entries := &stampedeCache{chats: map[string]models.Chat{}, misses: map[string]bool{}}
	service := services.NewChatService(
		repo, entries, newSingleHolderLocker(), passthroughCoalescer{}, lock.NewPolicy(time.Second),
		slog.New(slog.DiscardHandler), observability.NullTelemetry{},
	)

	var wg sync.WaitGroup
	for range 4 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			chat, _, _, err := service.GetChat(context.Background(), "owner-1", "chat-1")
			if err != nil {
				t.Errorf("GetChat: %v", err)
				return
			}
			if chat.Title != "filled" {
				t.Errorf("title = %q, want the filled chat", chat.Title)
			}
		}()
	}
	wg.Wait()

	if got := repo.chats.Load(); got != 1 {
		t.Errorf("source reads = %d, want exactly one", got)
	}
}
