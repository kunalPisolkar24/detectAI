package services

import (
	"fmt"
	"strings"
	"unicode/utf8"
)

// Bounds and limit clamps the contract's validation enforces; the spec names
// no maximums, so these numbers are this repo's recorded decisions.
const (
	MaxTitleLen   = 200
	MaxContentLen = 100000

	DefaultHistoryLimit = 50
	MaxHistoryLimit     = 200
	DefaultChatsLimit   = 50
	MaxChatsLimit       = 200
)

// ValidationError is a request payload failing the contract's validation; the
// service maps it to the wire's invalid-argument code.
type ValidationError struct {
	Field  string
	Reason string
}

func (e *ValidationError) Error() string {
	return fmt.Sprintf("services: %s %s", e.Field, e.Reason)
}

// ValidateChatTitle validates a create or rename title.
func ValidateChatTitle(title string) error {
	if err := nonEmpty("title", title); err != nil {
		return err
	}
	return bounded("title", title, MaxTitleLen)
}

// ValidateChatID validates a chat id on every chat-scoped path.
func ValidateChatID(chatID string) error {
	return nonEmpty("chat_id", chatID)
}

// ValidateContent validates a message body on its own.
func ValidateContent(content string) error {
	if err := nonEmpty("content", content); err != nil {
		return err
	}
	return bounded("content", content, MaxContentLen)
}

// ValidateUserMessage validates the SaveUserMessage payload.
func ValidateUserMessage(msg Message) error {
	if err := ValidateChatID(msg.ChatID); err != nil {
		return err
	}
	if msg.Role != RoleUser {
		return &ValidationError{Field: "role", Reason: fmt.Sprintf("must be %q on a user message; got %q", RoleUser, msg.Role)}
	}
	if msg.Analysis != nil {
		return &ValidationError{Field: "analysis", Reason: "must be unset on a user message"}
	}
	return ValidateContent(msg.Content)
}

// ValidateAnalysisMessage validates the SaveAnalysisMessage payload per state.
func ValidateAnalysisMessage(msg Message) error {
	if err := ValidateChatID(msg.ChatID); err != nil {
		return err
	}
	if msg.Role != RoleAssistant {
		return &ValidationError{Field: "role", Reason: fmt.Sprintf("must be %q on an analysis message; got %q", RoleAssistant, msg.Role)}
	}
	if msg.Content != "" {
		return &ValidationError{Field: "content", Reason: "must be empty on an analysis message"}
	}
	if msg.Analysis == nil {
		return &ValidationError{Field: "analysis", Reason: "is required on an analysis message"}
	}
	if err := nonEmpty("source_message_id", msg.Analysis.SourceMessageID); err != nil {
		return err
	}
	if !validState(msg.Analysis.State) {
		return &ValidationError{Field: "state", Reason: fmt.Sprintf("must be running, completed, failed, or cancelled; got %q", msg.Analysis.State)}
	}
	if msg.Analysis.Model != ModelSpark && msg.Analysis.Model != ModelFlare {
		return &ValidationError{Field: "model", Reason: fmt.Sprintf("must be spark or flare; got %q", msg.Analysis.Model)}
	}
	if msg.Analysis.State == StateCompleted && msg.Analysis.Result == nil {
		return &ValidationError{Field: "result", Reason: "is required when the state is completed"}
	}
	if msg.Analysis.State == StateFailed && msg.Analysis.Error == "" {
		return &ValidationError{Field: "error", Reason: "is required when the state is failed"}
	}
	return nil
}

// ClampHistoryLimit applies the history limit's server default and hard cap.
func ClampHistoryLimit(limit int) int {
	return clamp(limit, DefaultHistoryLimit, MaxHistoryLimit)
}

// ClampChatsLimit applies the sidebar limit's server default and hard cap.
func ClampChatsLimit(limit int) int {
	return clamp(limit, DefaultChatsLimit, MaxChatsLimit)
}

// DeriveChatTitle derives a chat's title from the message that opened it.
func DeriveChatTitle(initialMessage string) string {
	title := strings.TrimSpace(initialMessage)
	if utf8.RuneCountInString(title) > MaxTitleLen {
		title = string([]rune(title)[:MaxTitleLen])
	}
	return title
}

func validState(state AnalysisState) bool {
	switch state {
	case StateRunning, StateCompleted, StateFailed, StateCancelled:
		return true
	}
	return false
}

func nonEmpty(field, value string) error {
	if strings.TrimSpace(value) == "" {
		return &ValidationError{Field: field, Reason: "must not be empty"}
	}
	return nil
}

func bounded(field, value string, maximum int) error {
	if utf8.RuneCountInString(value) > maximum {
		return &ValidationError{Field: field, Reason: fmt.Sprintf("must be at most %d characters", maximum)}
	}
	return nil
}

func clamp(limit, fallback, maximum int) int {
	if limit <= 0 {
		return fallback
	}
	if limit > maximum {
		return maximum
	}
	return limit
}
