package models

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
