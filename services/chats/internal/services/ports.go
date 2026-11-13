package services

import (
	"context"
)

// Repository is the chat data-access contract the service codes against; the
// mongo adapter implements it. Every method threads the owner's id — ownership
// is a data invariant, so a chat missing or not owned answers ErrNotFound.
type Repository interface {
	// CreateChat inserts the chat shell — the service derives the title from
	// the initial message and saves the first user message through SaveUserMessage.
	CreateChat(ctx context.Context, ownerID, title string) (Chat, error)
	// Chat returns the owner-scoped chat meta.
	Chat(ctx context.Context, ownerID, chatID string) (Chat, error)
	// Chats lists the owner's chats newest-first by updated_at; a positive limit applies.
	Chats(ctx context.Context, ownerID string, limit int) ([]ChatSummary, error)
	// RenameChat sets the title and bumps updated_at, returning the summary.
	RenameChat(ctx context.Context, ownerID, chatID, title string) (ChatSummary, error)
	// DeleteChat deletes the chat then its messages without a transaction —
	// re-deleting an already-deleted chat succeeds, another owner's chat is ErrNotFound.
	DeleteChat(ctx context.Context, ownerID, chatID string) error
	// SaveUserMessage is insert-only — a duplicate id is a replay returning
	// the existing message, never overwritten.
	SaveUserMessage(ctx context.Context, ownerID string, msg Message) (Message, error)
	// SaveAnalysisMessage upserts the analysis state machine keyed on id —
	// created_at is set once, a foreign chat id is ErrNotFound, and a
	// non-replay write into a terminal state is ErrConflict.
	SaveAnalysisMessage(ctx context.Context, ownerID string, msg Message) (Message, error)
	// ChatHistory pages newest-first on the (created_at, _id) keyset — an
	// empty cursor is the first page and the next-cursor return is empty at the end.
	ChatHistory(ctx context.Context, ownerID, chatID, cursor string, limit int) ([]Message, string, error)
}

// Cache is the cache-aside surface over the chat entries the service reads
// through: a chat's meta, the head page of its messages, and an owner's
// sidebar list.
//
// A miss is (zero value, false, nil); an error means the cache plane itself
// failed and the caller absorbs it, because a cache fault never fails an RPC.
type Cache interface {
	// Chat returns the cached chat meta.
	Chat(ctx context.Context, chatID string) (Chat, bool, error)
	// PutChat caches the chat meta.
	PutChat(ctx context.Context, chat Chat) error
	// ChatList returns the cached sidebar list of an owner.
	ChatList(ctx context.Context, ownerID string) ([]ChatSummary, bool, error)
	// PutChatList caches the sidebar list of an owner.
	PutChatList(ctx context.Context, ownerID string, chats []ChatSummary) error
	// Head returns the cached head page of a chat's messages.
	Head(ctx context.Context, chatID string) (Page, bool, error)
	// PutHead caches the head page of a chat's messages.
	PutHead(ctx context.Context, chatID string, page Page) error
	// InvalidateMeta drops a chat's meta entry; the rename path leaves the
	// head page alone.
	InvalidateMeta(ctx context.Context, chatID string) error
	// InvalidateChat drops a chat's meta and head entries; the append,
	// update-analysis, and delete paths.
	InvalidateChat(ctx context.Context, chatID string) error
	// InvalidateOwner drops an owner's sidebar list.
	InvalidateOwner(ctx context.Context, ownerID string) error
}

// Limiter counts a caller's calls inside a fixed window and reports whether
// the call fits the budget.
//
// A fault in the cache plane fails open: the caller absorbs the error and
// lets the call through.
type Limiter interface {
	// Consume counts one call for the owner in the scope's window and
	// reports the decision.
	Consume(ctx context.Context, ownerID, scope string, limit int) (Decision, error)
}
