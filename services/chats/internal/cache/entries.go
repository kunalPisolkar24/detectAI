package cache

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	driver "github.com/redis/go-redis/v9"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/services"
)

// Entries is the redis-backed cache-aside surface.
type Entries struct {
	client *driver.Client
}

var _ services.Cache = (*Entries)(nil)

// NewEntries builds the entries surface over a connected client.
func NewEntries(client *Client) *Entries {
	return &Entries{client: client.client}
}

// Chat returns the cached chat meta.
func (e *Entries) Chat(ctx context.Context, chatID string) (services.Chat, bool, error) {
	var chat services.Chat
	found, err := e.get(ctx, ChatKey(chatID), &chat)
	if err != nil || !found {
		return services.Chat{}, false, err
	}
	return chat, true, nil
}

// PutChat caches the chat meta.
func (e *Entries) PutChat(ctx context.Context, chat services.Chat) error {
	return e.put(ctx, ChatKey(chat.ID), chat, ChatMetaTTL)
}

// ChatList returns the cached sidebar list of an owner.
func (e *Entries) ChatList(ctx context.Context, ownerID string) ([]services.ChatSummary, bool, error) {
	var chats []services.ChatSummary
	found, err := e.get(ctx, OwnerChatsKey(ownerID), &chats)
	if err != nil || !found {
		return nil, false, err
	}
	if chats == nil {
		chats = []services.ChatSummary{}
	}
	return chats, true, nil
}

// PutChatList caches the sidebar list of an owner.
func (e *Entries) PutChatList(ctx context.Context, ownerID string, chats []services.ChatSummary) error {
	return e.put(ctx, OwnerChatsKey(ownerID), chats, ChatListTTL)
}

// Head returns the cached head page of a chat's messages.
func (e *Entries) Head(ctx context.Context, chatID string) (services.Page, bool, error) {
	var page services.Page
	found, err := e.get(ctx, ChatHeadKey(chatID), &page)
	if err != nil || !found {
		return services.Page{}, false, err
	}
	if page.Messages == nil {
		page.Messages = []services.Message{}
	}
	return page, true, nil
}

// PutHead caches the head page of a chat's messages.
func (e *Entries) PutHead(ctx context.Context, chatID string, page services.Page) error {
	return e.put(ctx, ChatHeadKey(chatID), page, ChatHeadTTL)
}

// InvalidateMeta drops a chat's meta entry.
func (e *Entries) InvalidateMeta(ctx context.Context, chatID string) error {
	return e.del(ctx, ChatKey(chatID))
}

// InvalidateChat drops a chat's meta and head entries.
func (e *Entries) InvalidateChat(ctx context.Context, chatID string) error {
	return e.del(ctx, ChatKey(chatID), ChatHeadKey(chatID))
}

// InvalidateOwner drops an owner's sidebar list.
func (e *Entries) InvalidateOwner(ctx context.Context, ownerID string) error {
	return e.del(ctx, OwnerChatsKey(ownerID))
}

// get reads an entry and decodes it into target. A missing key is a miss, and
// so is a value that fails to decode: the entry predates the current shape,
// and the source re-read overwrites it.
func (e *Entries) get(ctx context.Context, key string, target any) (bool, error) {
	payload, err := e.client.Get(ctx, key).Bytes()
	if errors.Is(err, driver.Nil) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("redis: get %s: %w", key, err)
	}
	if err := json.Unmarshal(payload, target); err != nil {
		return false, nil
	}
	return true, nil
}

// put encodes a value and writes it with its TTL.
func (e *Entries) put(ctx context.Context, key string, value any, ttl time.Duration) error {
	payload, err := json.Marshal(value)
	if err != nil {
		return fmt.Errorf("redis: encode %s: %w", key, err)
	}
	if err := e.client.Set(ctx, key, payload, ttl).Err(); err != nil {
		return fmt.Errorf("redis: set %s: %w", key, err)
	}
	return nil
}

// del removes the given keys.
func (e *Entries) del(ctx context.Context, keys ...string) error {
	if err := e.client.Del(ctx, keys...).Err(); err != nil {
		return fmt.Errorf("redis: delete %v: %w", keys, err)
	}
	return nil
}
