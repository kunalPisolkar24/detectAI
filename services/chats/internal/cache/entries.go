package cache

import (
	"context"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/store"
)

// Entries is the cache-aside surface over the chat entries the service reads
// through: a chat's meta, the head page of its messages, and an owner's
// sidebar list.
//
// A miss is (zero value, false, nil); an error means the cache plane itself
// failed and the caller absorbs it, because a cache fault never fails an RPC.
type Entries interface {
	// Chat returns the cached chat meta.
	Chat(ctx context.Context, chatID string) (store.Chat, bool, error)
	// PutChat caches the chat meta.
	PutChat(ctx context.Context, chat store.Chat) error
	// ChatList returns the cached sidebar list of an owner.
	ChatList(ctx context.Context, ownerID string) ([]store.ChatSummary, bool, error)
	// PutChatList caches the sidebar list of an owner.
	PutChatList(ctx context.Context, ownerID string, chats []store.ChatSummary) error
	// Head returns the cached head page of a chat's messages.
	Head(ctx context.Context, chatID string) ([]store.Message, bool, error)
	// PutHead caches the head page of a chat's messages.
	PutHead(ctx context.Context, chatID string, messages []store.Message) error
	// InvalidateMeta drops a chat's meta entry; the rename path leaves the
	// head page alone.
	InvalidateMeta(ctx context.Context, chatID string) error
	// InvalidateChat drops a chat's meta and head entries; the append,
	// update-analysis, and delete paths.
	InvalidateChat(ctx context.Context, chatID string) error
	// InvalidateOwner drops an owner's sidebar list.
	InvalidateOwner(ctx context.Context, ownerID string) error
}
