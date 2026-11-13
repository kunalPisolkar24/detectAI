package services_test

import (
	"strings"
	"testing"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/services"
)

func userMessage(content string) services.Message {
	return services.Message{ID: "m1", ChatID: "chat-1", Role: services.RoleUser, Content: content}
}

func analysisMessage(mutate func(*services.Analysis)) services.Message {
	payload := &services.Analysis{State: services.StateRunning, Model: services.ModelSpark, SourceMessageID: "m-src"}
	if mutate != nil {
		mutate(payload)
	}
	return services.Message{ID: "a1", ChatID: "chat-1", Role: services.RoleAssistant, Analysis: payload}
}

func completedResult() *services.AnalysisResult {
	return &services.AnalysisResult{Label: services.LabelAI, Confidence: 0.9, Scores: services.Scores{AI: 0.9, Human: 0.1}}
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
		"the exact bound serves": {title: strings.Repeat("a", services.MaxTitleLen)},
		"over the bound fails":   {title: strings.Repeat("a", services.MaxTitleLen+1), wantErr: "title must be at most 200 characters"},
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
		msg     services.Message
		wantErr string
	}{
		"a well-formed user message serves": {msg: userMessage("hello there")},
		"the exact content bound serves":    {msg: userMessage(strings.Repeat("a", services.MaxContentLen))},
		"over the content bound fails":      {msg: userMessage(strings.Repeat("a", services.MaxContentLen+1)), wantErr: "content must be at most 100000 characters"},
		"an empty content fails":            {msg: userMessage(""), wantErr: "content must not be empty"},
		"a whitespace content fails":        {msg: userMessage("   "), wantErr: "content must not be empty"},
		"a missing chat id fails":           {msg: services.Message{Role: services.RoleUser, Content: "hi"}, wantErr: "chat_id must not be empty"},
		"the assistant role fails":          {msg: services.Message{ChatID: "chat-1", Role: services.RoleAssistant, Content: "hi"}, wantErr: `role must be "user" on a user message`},
		"an unset role fails":               {msg: services.Message{ChatID: "chat-1", Content: "hi"}, wantErr: `role must be "user" on a user message`},
		"an analysis payload fails":         {msg: services.Message{ChatID: "chat-1", Role: services.RoleUser, Content: "hi", Analysis: &services.Analysis{}}, wantErr: "analysis must be unset on a user message"},
	} {
		t.Run(name, func(t *testing.T) {
			assertPayload(t, services.ValidateUserMessage(tc.msg), tc.wantErr)
		})
	}
}

func TestValidateAnalysisMessage(t *testing.T) {
	for name, tc := range map[string]struct {
		msg     services.Message
		wantErr string
	}{
		"a running save serves":            {msg: analysisMessage(nil)},
		"a completed save serves":          {msg: analysisMessage(func(a *services.Analysis) { a.State = services.StateCompleted; a.Result = completedResult() })},
		"a failed save serves":             {msg: analysisMessage(func(a *services.Analysis) { a.State = services.StateFailed; a.Error = "boom" })},
		"a cancelled save serves":          {msg: analysisMessage(func(a *services.Analysis) { a.State = services.StateCancelled })},
		"the user role fails":              {msg: services.Message{ChatID: "chat-1", Role: services.RoleUser, Analysis: &services.Analysis{}}, wantErr: `role must be "assistant" on an analysis message`},
		"content on the message fails":     {msg: services.Message{ChatID: "chat-1", Role: services.RoleAssistant, Content: "hi", Analysis: &services.Analysis{State: services.StateRunning, Model: services.ModelSpark, SourceMessageID: "m-src"}}, wantErr: "content must be empty on an analysis message"},
		"a missing analysis payload fails": {msg: services.Message{ChatID: "chat-1", Role: services.RoleAssistant}, wantErr: "analysis is required on an analysis message"},
		"a missing source message fails":   {msg: analysisMessage(func(a *services.Analysis) { a.SourceMessageID = " " }), wantErr: "source_message_id must not be empty"},
		"an unknown state fails":           {msg: analysisMessage(func(a *services.Analysis) { a.State = "weird" }), wantErr: `state must be running, completed, failed, or cancelled; got "weird"`},
		"an unknown model fails":           {msg: analysisMessage(func(a *services.Analysis) { a.Model = "gpt" }), wantErr: `model must be spark or flare; got "gpt"`},
		"completed without a result fails": {msg: analysisMessage(func(a *services.Analysis) { a.State = services.StateCompleted }), wantErr: "result is required when the state is completed"},
		"failed without an error fails":    {msg: analysisMessage(func(a *services.Analysis) { a.State = services.StateFailed }), wantErr: "error is required when the state is failed"},
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
		"unset takes the default":    {limit: 0, want: services.DefaultHistoryLimit},
		"negative takes the default": {limit: -5, want: services.DefaultHistoryLimit},
		"inside the cap rides":       {limit: 10, want: 10},
		"the cap holds exactly":      {limit: services.MaxHistoryLimit, want: services.MaxHistoryLimit},
		"over the cap clamps":        {limit: services.MaxHistoryLimit + 1, want: services.MaxHistoryLimit},
	} {
		t.Run(name, func(t *testing.T) {
			if got := services.ClampHistoryLimit(tc.limit); got != tc.want {
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
		"unset takes the default":    {limit: 0, want: services.DefaultChatsLimit},
		"negative takes the default": {limit: -5, want: services.DefaultChatsLimit},
		"inside the cap rides":       {limit: 10, want: 10},
		"the cap holds exactly":      {limit: services.MaxChatsLimit, want: services.MaxChatsLimit},
		"over the cap clamps":        {limit: services.MaxChatsLimit + 1, want: services.MaxChatsLimit},
	} {
		t.Run(name, func(t *testing.T) {
			if got := services.ClampChatsLimit(tc.limit); got != tc.want {
				t.Errorf("ClampChatsLimit(%d) = %d, want %d", tc.limit, got, tc.want)
			}
		})
	}
}
