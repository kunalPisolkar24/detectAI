// Package store declares the chat repository contract, the domain types the
// service maps the wire onto, and their validators.
package store

import (
	"context"
	"errors"
	"time"
)

// Sentinel errors the adapters return and the service maps to Connect codes.
var (
	// ErrNotFound answers a chat missing or not owned by the caller, and a
	// message id bound to a different chat — one error for "missing" and "not yours".
	ErrNotFound = errors.New("store: not found")
	// ErrInvalidCursor answers a malformed or foreign-chat history cursor —
	// never a fallback to the first page, or scrollback would loop forever.
	ErrInvalidCursor = errors.New("store: invalid cursor")
	// ErrConflict answers a write into a terminal analysis state that is not
	// an identical replay of what is stored.
	ErrConflict = errors.New("store: terminal analysis state conflict")
)

// Role is the message author.
type Role string

const (
	RoleUser      Role = "user"
	RoleAssistant Role = "assistant"
)

// Model is the inference model an analysis ran on.
type Model string

const (
	ModelSpark Model = "spark"
	ModelFlare Model = "flare"
)

// AnalysisState is the analysis state machine.
type AnalysisState string

const (
	StateRunning   AnalysisState = "running"
	StateCompleted AnalysisState = "completed"
	StateFailed    AnalysisState = "failed"
	StateCancelled AnalysisState = "cancelled"
)

// Label is the detection verdict.
type Label string

const (
	LabelAI    Label = "ai"
	LabelHuman Label = "human"
)

// Chat is one chat session document; the service composes the wire Chat by
// joining this meta with a head page of messages.
type Chat struct {
	ID        string    `bson:"_id"`
	UserID    string    `bson:"user_id"`
	Title     string    `bson:"title"`
	CreatedAt time.Time `bson:"created_at"`
	UpdatedAt time.Time `bson:"updated_at"`
}

// ChatSummary is the sidebar projection of a chat.
type ChatSummary struct {
	ID        string    `bson:"_id"`
	Title     string    `bson:"title"`
	UpdatedAt time.Time `bson:"updated_at"`
}

// Message is one flat message document; assistant analysis messages embed
// their analysis payload inline.
type Message struct {
	ID        string    `bson:"_id"`
	ChatID    string    `bson:"chat_id"`
	Role      Role      `bson:"role"`
	Content   string    `bson:"content,omitempty"`
	Analysis  *Analysis `bson:"analysis,omitempty"`
	CreatedAt time.Time `bson:"created_at"`
}

// Analysis is the embedded analysis payload on assistant messages.
type Analysis struct {
	State           AnalysisState   `bson:"state"`
	Model           Model           `bson:"model"`
	SourceMessageID string          `bson:"source_message_id"`
	Error           string          `bson:"error,omitempty"`
	Result          *AnalysisResult `bson:"result,omitempty"`
}

// AnalysisResult is the detection verdict; Raw is the capped passthrough payload.
type AnalysisResult struct {
	Label      Label          `bson:"label"`
	Confidence float64        `bson:"confidence"`
	Scores     Scores         `bson:"scores"`
	Highlights []Highlight    `bson:"highlights"`
	Raw        map[string]any `bson:"raw,omitempty"`
}

// Scores are the AI-vs-human detector probabilities.
type Scores struct {
	AI    float64 `bson:"ai"`
	Human float64 `bson:"human"`
}

// Highlight is one detection span within the analyzed text.
type Highlight struct {
	CharStart    int32   `bson:"char_start"`
	CharEnd      int32   `bson:"char_end"`
	AIConfidence float64 `bson:"ai_confidence"`
	Label        Label   `bson:"label"`
}

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
