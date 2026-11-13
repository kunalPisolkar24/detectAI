package services

import "time"

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

// Page is a chat's head page of messages and the cursor that chains to the
// next one.
type Page struct {
	Messages   []Message `json:"messages"`
	NextCursor string    `json:"next_cursor"`
}

// Decision is the outcome of one counted call.
type Decision struct {
	// Allowed reports whether the call fits the limit.
	Allowed bool
	// Count is the calls counted in the window, this one included.
	Count int
	// Limit is the budget the call was measured against.
	Limit int
	// RetryAfter is the time left in the window.
	RetryAfter time.Duration
}
