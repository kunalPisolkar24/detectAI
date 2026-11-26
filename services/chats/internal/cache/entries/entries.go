package entries

import (
	"context"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/cache/keys"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/cache/store"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/models"
)

// Cache is the cache-aside surface over a chat's meta, the head page of its
// messages, and an owner's sidebar list. A miss is (zero value, false, nil);
// an error means the cache plane itself failed and the caller absorbs it,
// because a cache fault never fails an RPC.
type Cache interface {
	Chat(ctx context.Context, chatID string) (models.Chat, bool, error)
	PutChat(ctx context.Context, chat models.Chat) error
	ChatList(ctx context.Context, ownerID string) ([]models.ChatSummary, bool, error)
	PutChatList(ctx context.Context, ownerID string, chats []models.ChatSummary) error
	Head(ctx context.Context, chatID string) (models.Page, bool, error)
	PutHead(ctx context.Context, chatID string, page models.Page) error
	InvalidateMeta(ctx context.Context, chatID string) error
	InvalidateChat(ctx context.Context, chatID string) error
	InvalidateOwner(ctx context.Context, ownerID string) error
}

type Entries struct {
	store store.Store
}

var _ Cache = (*Entries)(nil)

func New(store store.Store) *Entries {
	return &Entries{store: store}
}

func (e *Entries) Chat(ctx context.Context, chatID string) (models.Chat, bool, error) {
	var chat models.Chat
	found, err := e.store.Get(ctx, keys.ChatKey(chatID), &chat)
	if err != nil || !found {
		return models.Chat{}, false, err
	}
	return chat, true, nil
}

func (e *Entries) PutChat(ctx context.Context, chat models.Chat) error {
	return e.store.Set(ctx, keys.ChatKey(chat.ID), chat, keys.ChatMetaTTL)
}

func (e *Entries) ChatList(ctx context.Context, ownerID string) ([]models.ChatSummary, bool, error) {
	var chats []models.ChatSummary
	found, err := e.store.Get(ctx, keys.OwnerChatsKey(ownerID), &chats)
	if err != nil || !found {
		return nil, false, err
	}
	if chats == nil {
		chats = []models.ChatSummary{}
	}
	return chats, true, nil
}

func (e *Entries) PutChatList(ctx context.Context, ownerID string, chats []models.ChatSummary) error {
	return e.store.Set(ctx, keys.OwnerChatsKey(ownerID), chats, keys.ChatListTTL)
}

func (e *Entries) Head(ctx context.Context, chatID string) (models.Page, bool, error) {
	var page models.Page
	found, err := e.store.Get(ctx, keys.ChatHeadKey(chatID), &page)
	if err != nil || !found {
		return models.Page{}, false, err
	}
	if page.Messages == nil {
		page.Messages = []models.Message{}
	}
	return page, true, nil
}

func (e *Entries) PutHead(ctx context.Context, chatID string, page models.Page) error {
	return e.store.Set(ctx, keys.ChatHeadKey(chatID), page, keys.ChatHeadTTL)
}

func (e *Entries) InvalidateMeta(ctx context.Context, chatID string) error {
	return e.store.Delete(ctx, keys.ChatKey(chatID))
}

func (e *Entries) InvalidateChat(ctx context.Context, chatID string) error {
	return e.store.Delete(ctx, keys.ChatKey(chatID), keys.ChatHeadKey(chatID))
}

func (e *Entries) InvalidateOwner(ctx context.Context, ownerID string) error {
	return e.store.Delete(ctx, keys.OwnerChatsKey(ownerID))
}
