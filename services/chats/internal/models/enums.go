package models

type Role string

const (
	RoleUser      Role = "user"
	RoleAssistant Role = "assistant"
)

type Model string

const (
	ModelSpark Model = "spark"
	ModelFlare Model = "flare"
)

type AnalysisState string

const (
	StateRunning   AnalysisState = "running"
	StateCompleted AnalysisState = "completed"
	StateFailed    AnalysisState = "failed"
	StateCancelled AnalysisState = "cancelled"
)

type Label string

const (
	LabelAI    Label = "ai"
	LabelHuman Label = "human"
)
