package services

import (
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/models"
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
	return bounded("title", title, models.MaxTitleLen)
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
	return bounded("content", content, models.MaxContentLen)
}

// ValidateUserMessage validates the SaveUserMessage payload.
func ValidateUserMessage(msg models.Message) error {
	if err := ValidateChatID(msg.ChatID); err != nil {
		return err
	}
	if msg.Role != models.RoleUser {
		return &ValidationError{Field: "role", Reason: fmt.Sprintf("must be %q on a user message; got %q", models.RoleUser, msg.Role)}
	}
	if msg.Analysis != nil {
		return &ValidationError{Field: "analysis", Reason: "must be unset on a user message"}
	}
	return ValidateContent(msg.Content)
}

// ValidateAnalysisMessage validates the SaveAnalysisMessage payload per state.
func ValidateAnalysisMessage(msg models.Message) error {
	if err := ValidateChatID(msg.ChatID); err != nil {
		return err
	}
	if msg.Role != models.RoleAssistant {
		return &ValidationError{Field: "role", Reason: fmt.Sprintf("must be %q on an analysis message; got %q", models.RoleAssistant, msg.Role)}
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
	if msg.Analysis.Model != models.ModelSpark && msg.Analysis.Model != models.ModelFlare {
		return &ValidationError{Field: "model", Reason: fmt.Sprintf("must be spark or flare; got %q", msg.Analysis.Model)}
	}
	if msg.Analysis.State == models.StateCompleted && msg.Analysis.Result == nil {
		return &ValidationError{Field: "result", Reason: "is required when the state is completed"}
	}
	if msg.Analysis.State == models.StateFailed && msg.Analysis.Error == "" {
		return &ValidationError{Field: "error", Reason: "is required when the state is failed"}
	}
	return nil
}

// DeriveChatTitle derives a chat's title from the message that opened it.
func DeriveChatTitle(initialMessage string) string {
	title := strings.TrimSpace(initialMessage)
	if utf8.RuneCountInString(title) > models.MaxTitleLen {
		title = string([]rune(title)[:models.MaxTitleLen])
	}
	return title
}

func validState(state models.AnalysisState) bool {
	switch state {
	case models.StateRunning, models.StateCompleted, models.StateFailed, models.StateCancelled:
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
