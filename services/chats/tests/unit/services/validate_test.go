package services_test

import (
	"strings"
	"testing"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/models"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/services"
)

func userMessage(content string) models.Message {
	return models.Message{ID: "m1", ChatID: "chat-1", Role: models.RoleUser, Content: content}
}

func analysisMessage(mutate func(*models.Analysis)) models.Message {
	payload := &models.Analysis{State: models.StateRunning, Model: models.ModelSpark, SourceMessageID: "m-src"}
	if mutate != nil {
		mutate(payload)
	}
	return models.Message{ID: "a1", ChatID: "chat-1", Role: models.RoleAssistant, Analysis: payload}
}

func completedResult() *models.AnalysisResult {
	return &models.AnalysisResult{Label: models.LabelAI, Confidence: 0.9, Scores: models.Scores{AI: 0.9, Human: 0.1}}
}

// assertPayload wants nil when want is empty, otherwise a validation error carrying it.
func assertPayload(t *testing.T, err error, want string) {
	t.Helper()
	if want == "" {
		if err != nil {
			t.Fatalf("err = %v, want nil", err)
		}
		return
	}
	if err == nil || !strings.Contains(err.Error(), want) {
		t.Errorf("err = %v, want it to contain %q", err, want)
	}
}

func TestValidateChatTitle(t *testing.T) {
	for name, tc := range map[string]struct {
		title   string
		wantErr string
	}{
		"one character serves":   {title: "a"},
		"the exact bound serves": {title: strings.Repeat("a", models.MaxTitleLen)},
		"over the bound fails":   {title: strings.Repeat("a", models.MaxTitleLen+1), wantErr: "title must be at most 200 characters"},
		"empty fails":            {title: "", wantErr: "title must not be empty"},
		"whitespace-only fails":  {title: "   ", wantErr: "title must not be empty"},
	} {
		t.Run(name, func(t *testing.T) {
			assertPayload(t, services.ValidateChatTitle(tc.title), tc.wantErr)
		})
	}
}

func TestValidateChatID(t *testing.T) {
	assertPayload(t, services.ValidateChatID("chat-1"), "")
	assertPayload(t, services.ValidateChatID(""), "chat_id must not be empty")
	assertPayload(t, services.ValidateChatID("   "), "chat_id must not be empty")
}

func TestValidateUserMessage(t *testing.T) {
	for name, tc := range map[string]struct {
		msg     models.Message
		wantErr string
	}{
		"a well-formed user message serves": {msg: userMessage("hello there")},
		"the exact content bound serves":    {msg: userMessage(strings.Repeat("a", models.MaxContentLen))},
		"over the content bound fails":      {msg: userMessage(strings.Repeat("a", models.MaxContentLen+1)), wantErr: "content must be at most 100000 characters"},
		"an empty content fails":            {msg: userMessage(""), wantErr: "content must not be empty"},
		"a whitespace content fails":        {msg: userMessage("   "), wantErr: "content must not be empty"},
		"a missing chat id fails":           {msg: models.Message{Role: models.RoleUser, Content: "hi"}, wantErr: "chat_id must not be empty"},
		"the assistant role fails":          {msg: models.Message{ChatID: "chat-1", Role: models.RoleAssistant, Content: "hi"}, wantErr: `role must be "user" on a user message`},
		"an unset role fails":               {msg: models.Message{ChatID: "chat-1", Content: "hi"}, wantErr: `role must be "user" on a user message`},
		"an analysis payload fails":         {msg: models.Message{ChatID: "chat-1", Role: models.RoleUser, Content: "hi", Analysis: &models.Analysis{}}, wantErr: "analysis must be unset on a user message"},
	} {
		t.Run(name, func(t *testing.T) {
			assertPayload(t, services.ValidateUserMessage(tc.msg), tc.wantErr)
		})
	}
}

func TestValidateAnalysisMessage(t *testing.T) {
	for name, tc := range map[string]struct {
		msg     models.Message
		wantErr string
	}{
		"a running save serves":            {msg: analysisMessage(nil)},
		"a completed save serves":          {msg: analysisMessage(func(a *models.Analysis) { a.State = models.StateCompleted; a.Result = completedResult() })},
		"a failed save serves":             {msg: analysisMessage(func(a *models.Analysis) { a.State = models.StateFailed; a.Error = "boom" })},
		"a cancelled save serves":          {msg: analysisMessage(func(a *models.Analysis) { a.State = models.StateCancelled })},
		"the user role fails":              {msg: models.Message{ChatID: "chat-1", Role: models.RoleUser, Analysis: &models.Analysis{}}, wantErr: `role must be "assistant" on an analysis message`},
		"content on the message fails":     {msg: models.Message{ChatID: "chat-1", Role: models.RoleAssistant, Content: "hi", Analysis: &models.Analysis{State: models.StateRunning, Model: models.ModelSpark, SourceMessageID: "m-src"}}, wantErr: "content must be empty on an analysis message"},
		"a missing analysis payload fails": {msg: models.Message{ChatID: "chat-1", Role: models.RoleAssistant}, wantErr: "analysis is required on an analysis message"},
		"a missing source message fails":   {msg: analysisMessage(func(a *models.Analysis) { a.SourceMessageID = " " }), wantErr: "source_message_id must not be empty"},
		"an unknown state fails":           {msg: analysisMessage(func(a *models.Analysis) { a.State = "weird" }), wantErr: `state must be running, completed, failed, or cancelled; got "weird"`},
		"an unknown model fails":           {msg: analysisMessage(func(a *models.Analysis) { a.Model = "gpt" }), wantErr: `model must be spark or flare; got "gpt"`},
		"completed without a result fails": {msg: analysisMessage(func(a *models.Analysis) { a.State = models.StateCompleted }), wantErr: "result is required when the state is completed"},
		"failed without an error fails":    {msg: analysisMessage(func(a *models.Analysis) { a.State = models.StateFailed }), wantErr: "error is required when the state is failed"},
	} {
		t.Run(name, func(t *testing.T) {
			assertPayload(t, services.ValidateAnalysisMessage(tc.msg), tc.wantErr)
		})
	}
}

func TestClampHistoryLimit(t *testing.T) {
	for name, tc := range map[string]struct {
		limit int
		want  int
	}{
		"unset takes the default":    {limit: 0, want: models.DefaultHistoryLimit},
		"negative takes the default": {limit: -5, want: models.DefaultHistoryLimit},
		"inside the cap rides":       {limit: 10, want: 10},
		"the cap holds exactly":      {limit: models.MaxHistoryLimit, want: models.MaxHistoryLimit},
		"over the cap clamps":        {limit: models.MaxHistoryLimit + 1, want: models.MaxHistoryLimit},
	} {
		t.Run(name, func(t *testing.T) {
			if got := models.ClampHistoryLimit(tc.limit); got != tc.want {
				t.Errorf("ClampHistoryLimit(%d) = %d, want %d", tc.limit, got, tc.want)
			}
		})
	}
}

func TestClampChatsLimit(t *testing.T) {
	for name, tc := range map[string]struct {
		limit int
		want  int
	}{
		"unset takes the default":    {limit: 0, want: models.DefaultChatsLimit},
		"negative takes the default": {limit: -5, want: models.DefaultChatsLimit},
		"inside the cap rides":       {limit: 10, want: 10},
		"the cap holds exactly":      {limit: models.MaxChatsLimit, want: models.MaxChatsLimit},
		"over the cap clamps":        {limit: models.MaxChatsLimit + 1, want: models.MaxChatsLimit},
	} {
		t.Run(name, func(t *testing.T) {
			if got := models.ClampChatsLimit(tc.limit); got != tc.want {
				t.Errorf("ClampChatsLimit(%d) = %d, want %d", tc.limit, got, tc.want)
			}
		})
	}
}
