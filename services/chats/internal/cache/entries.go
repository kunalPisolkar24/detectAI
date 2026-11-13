package cache

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	driver "github.com/redis/go-redis/v9"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/models"
)

type Entries struct {
	client *driver.Client
}

var _ Cache = (*Entries)(nil)

func NewEntries(client *Client) *Entries {
	return &Entries{client: client.client}
}

func (e *Entries) Chat(ctx context.Context, chatID string) (models.Chat, bool, error) {
	var chat models.Chat
	found, err := e.get(ctx, ChatKey(chatID), &chat)
	if err != nil || !found {
		return models.Chat{}, false, err
	}
	return chat, true, nil
}

func (e *Entries) PutChat(ctx context.Context, chat models.Chat) error {
	return e.put(ctx, ChatKey(chat.ID), chat, ChatMetaTTL)
}

func (e *Entries) ChatList(ctx context.Context, ownerID string) ([]models.ChatSummary, bool, error) {
	var chats []models.ChatSummary
	found, err := e.get(ctx, OwnerChatsKey(ownerID), &chats)
	if err != nil || !found {
		return nil, false, err
	}
	if chats == nil {
		chats = []models.ChatSummary{}
	}
	return chats, true, nil
}

func (e *Entries) PutChatList(ctx context.Context, ownerID string, chats []models.ChatSummary) error {
	return e.put(ctx, OwnerChatsKey(ownerID), chats, ChatListTTL)
}

func (e *Entries) Head(ctx context.Context, chatID string) (models.Page, bool, error) {
	var page models.Page
	found, err := e.get(ctx, ChatHeadKey(chatID), &page)
	if err != nil || !found {
		return models.Page{}, false, err
	}
	if page.Messages == nil {
		page.Messages = []models.Message{}
	}
	return page, true, nil
}

func (e *Entries) PutHead(ctx context.Context, chatID string, page models.Page) error {
	return e.put(ctx, ChatHeadKey(chatID), page, ChatHeadTTL)
}

func (e *Entries) InvalidateMeta(ctx context.Context, chatID string) error {
	return e.del(ctx, ChatKey(chatID))
}

func (e *Entries) InvalidateChat(ctx context.Context, chatID string) error {
	return e.del(ctx, ChatKey(chatID), ChatHeadKey(chatID))
}

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

func (e *Entries) del(ctx context.Context, keys ...string) error {
	if err := e.client.Del(ctx, keys...).Err(); err != nil {
		return fmt.Errorf("redis: delete %v: %w", keys, err)
	}
	return nil
}
