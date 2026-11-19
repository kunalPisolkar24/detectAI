// Package models holds the chats vocabulary: the document shapes the stores
// persist, the enums they carry, and the rules the domain and the adapters share.
package models

import "time"

// Chat is one chat session document; the service composes the wire Chat by
// joining this meta with a head page of messages.
type Chat struct {
	ID        string    `bson:"_id"`
	UserID    string    `bson:"user_id"`
	Title     string    `bson:"title"`
	CreatedAt time.Time `bson:"created_at"`
	UpdatedAt time.Time `bson:"updated_at"`
}

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

type Scores struct {
	AI    float64 `bson:"ai"`
	Human float64 `bson:"human"`
}

type Highlight struct {
	CharStart    int32   `bson:"char_start"`
	CharEnd      int32   `bson:"char_end"`
	AIConfidence float64 `bson:"ai_confidence"`
	Label        Label   `bson:"label"`
}

type Page struct {
	Messages   []Message `json:"messages"`
	NextCursor string    `json:"next_cursor"`
}
