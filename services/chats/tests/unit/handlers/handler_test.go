// Package handlers_test drives the ChatService handler over a stub service.
package handlers_test

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"

	chatshandlers "github.com/kunalPisolkar24/detectAI/services/chats/internal/handlers"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/services"
	chatv1 "github.com/kunalPisolkar24/detectAI/services/chats/proto"
)

const testAPIKey = "key-0123456789abcdef79"

// stubService answers the RPCs the handler tests exercise.
type stubService struct {
	createChat          func(ctx context.Context, ownerID, initialMessage string) (services.Chat, error)
	chat                func(ctx context.Context, ownerID, chatID string) (services.Chat, []services.Message, string, error)
	chats               func(ctx context.Context, ownerID string, limit int) ([]services.ChatSummary, error)
	renameChat          func(ctx context.Context, ownerID, chatID, title string) (services.ChatSummary, error)
	deleteChat          func(ctx context.Context, ownerID, chatID string) error
	saveUserMessage     func(ctx context.Context, ownerID, chatID, messageID, content string, createdAt time.Time) (services.Message, error)
	saveAnalysisMessage func(ctx context.Context, ownerID, chatID, messageID string, createdAt time.Time, analysis *services.Analysis) (services.Message, error)
	chatHistory         func(ctx context.Context, ownerID, chatID, cursor string, limit int) ([]services.Message, string, error)
}

func (s stubService) CreateChat(ctx context.Context, ownerID, initialMessage string) (services.Chat, error) {
	if s.createChat == nil {
		return services.Chat{}, nil
	}
	return s.createChat(ctx, ownerID, initialMessage)
}

func (s stubService) GetChat(ctx context.Context, ownerID, chatID string) (services.Chat, []services.Message, string, error) {
	if s.chat == nil {
		return services.Chat{}, nil, "", nil
	}
	return s.chat(ctx, ownerID, chatID)
}

func (s stubService) ListChats(ctx context.Context, ownerID string, limit int) ([]services.ChatSummary, error) {
	if s.chats == nil {
		return nil, nil
	}
	return s.chats(ctx, ownerID, limit)
}

func (s stubService) RenameChat(ctx context.Context, ownerID, chatID, title string) (services.ChatSummary, error) {
	if s.renameChat == nil {
		return services.ChatSummary{}, nil
	}
	return s.renameChat(ctx, ownerID, chatID, title)
}

func (s stubService) DeleteChat(ctx context.Context, ownerID, chatID string) error {
	if s.deleteChat == nil {
		return nil
	}
	return s.deleteChat(ctx, ownerID, chatID)
}

func (s stubService) SaveUserMessage(ctx context.Context, ownerID, chatID, messageID, content string, createdAt time.Time) (services.Message, error) {
	if s.saveUserMessage == nil {
		return services.Message{}, nil
	}
	return s.saveUserMessage(ctx, ownerID, chatID, messageID, content, createdAt)
}

func (s stubService) SaveAnalysisMessage(ctx context.Context, ownerID, chatID, messageID string, createdAt time.Time, analysis *services.Analysis) (services.Message, error) {
	if s.saveAnalysisMessage == nil {
		return services.Message{}, nil
	}
	return s.saveAnalysisMessage(ctx, ownerID, chatID, messageID, createdAt, analysis)
}

func (s stubService) GetChatHistory(ctx context.Context, ownerID, chatID, cursor string, limit int) ([]services.Message, string, error) {
	if s.chatHistory == nil {
		return nil, "", nil
	}
	return s.chatHistory(ctx, ownerID, chatID, cursor, limit)
}

// ownerContext runs the auth interceptor and returns the context it resolved.
func ownerContext(t *testing.T, apiKey, ownerID string) context.Context {
	t.Helper()
	req := connect.NewRequest(&chatv1.GetChatRequest{})
	req.Header().Set("x-api-key", apiKey)
	req.Header().Set("x-user-id", ownerID)

	var resolved context.Context
	interceptor := chatshandlers.NewAuthInterceptor(apiKey)
	if _, err := interceptor(func(ctx context.Context, _ connect.AnyRequest) (connect.AnyResponse, error) {
		resolved = ctx
		return nil, nil
	})(context.Background(), req); err != nil {
		t.Fatalf("auth interceptor: %v", err)
	}
	return resolved
}

func TestGetChatReturnsTheMetaAndTheHeadPage(t *testing.T) {
	service := stubService{
		chat: func(_ context.Context, ownerID, chatID string) (services.Chat, []services.Message, string, error) {
			return services.Chat{ID: chatID, UserID: ownerID, Title: "a title"},
				[]services.Message{{ID: "m1", ChatID: chatID, Role: services.RoleUser, Content: "hello"}},
				"cursor-1",
				nil
		},
	}
	handler := chatshandlers.New(service)

	resp, err := handler.GetChat(ownerContext(t, testAPIKey, "owner-1"), connect.NewRequest(&chatv1.GetChatRequest{ChatId: "chat-1"}))
	if err != nil {
		t.Fatalf("GetChat: %v", err)
	}
	if resp.Msg.Id != "chat-1" || resp.Msg.Title != "a title" {
		t.Errorf("chat = %+v, want the id and title", resp.Msg)
	}
	if len(resp.Msg.Messages) != 1 || resp.Msg.Messages[0].Content != "hello" {
		t.Errorf("messages = %+v, want the head page", resp.Msg.Messages)
	}
	if resp.Msg.Messages[0].Role != chatv1.Role_ROLE_USER {
		t.Errorf("role = %v, want %v", resp.Msg.Messages[0].Role, chatv1.Role_ROLE_USER)
	}
	if resp.Msg.NextCursor != "cursor-1" {
		t.Errorf("next cursor = %q, want %q", resp.Msg.NextCursor, "cursor-1")
	}
}

func TestSaveAnalysisMessageMapsTheAnalysisPayload(t *testing.T) {
	var captured *services.Analysis
	service := stubService{
		saveAnalysisMessage: func(_ context.Context, _, chatID, messageID string, _ time.Time, analysis *services.Analysis) (services.Message, error) {
			captured = analysis
			return services.Message{ID: messageID, ChatID: chatID, Role: services.RoleAssistant, Analysis: analysis}, nil
		},
	}
	handler := chatshandlers.New(service)

	req := connect.NewRequest(&chatv1.SaveAnalysisMessageRequest{
		ChatId:          "chat-1",
		MessageId:       "a1",
		State:           chatv1.AnalysisState_ANALYSIS_STATE_COMPLETED,
		Model:           chatv1.Model_MODEL_SPARK,
		SourceMessageId: "m1",
		Analysis: &chatv1.AnalysisResult{
			Label:      chatv1.Label_LABEL_AI,
			Confidence: 0.9,
			Scores:     &chatv1.Scores{Ai: 0.9, Human: 0.1},
		},
	})

	resp, err := handler.SaveAnalysisMessage(ownerContext(t, testAPIKey, "owner-1"), req)
	if err != nil {
		t.Fatalf("SaveAnalysisMessage: %v", err)
	}
	if captured == nil {
		t.Fatal("the service got no analysis payload")
	}
	if captured.State != services.StateCompleted || captured.Model != services.ModelSpark {
		t.Errorf("analysis = %+v, want the completed spark state", captured)
	}
	if captured.SourceMessageID != "m1" {
		t.Errorf("source message id = %q, want %q", captured.SourceMessageID, "m1")
	}
	if captured.Result == nil || captured.Result.Label != services.LabelAI {
		t.Errorf("result = %+v, want the ai verdict", captured.Result)
	}
	if captured.Result.Confidence != 0.9 {
		t.Errorf("confidence = %v, want 0.9", captured.Result.Confidence)
	}
	if resp.Msg.Analysis == nil || resp.Msg.Analysis.State != chatv1.AnalysisState_ANALYSIS_STATE_COMPLETED {
		t.Errorf("analysis = %+v, want the completed state", resp.Msg.Analysis)
	}
}

func TestSaveUserMessagePassesTheRequestThrough(t *testing.T) {
	var ownerID, chatID, messageID, content string
	service := stubService{
		saveUserMessage: func(_ context.Context, owner, chat, message, body string, _ time.Time) (services.Message, error) {
			ownerID, chatID, messageID, content = owner, chat, message, body
			return services.Message{ID: message, ChatID: chat, Role: services.RoleUser, Content: body}, nil
		},
	}
	handler := chatshandlers.New(service)

	req := connect.NewRequest(&chatv1.SaveUserMessageRequest{
		ChatId:    "chat-1",
		MessageId: "m1",
		Content:   "hello",
	})

	if _, err := handler.SaveUserMessage(ownerContext(t, testAPIKey, "owner-1"), req); err != nil {
		t.Fatalf("SaveUserMessage: %v", err)
	}
	if ownerID != "owner-1" || chatID != "chat-1" || messageID != "m1" || content != "hello" {
		t.Errorf("service got %q/%q/%q/%q, want the request and the resolved owner", ownerID, chatID, messageID, content)
	}
}

func TestTheServiceErrorsMapOntoConnectCodes(t *testing.T) {
	for name, tc := range map[string]struct {
		err  error
		want connect.Code
	}{
		"a missing chat":        {err: services.ErrNotFound, want: connect.CodeNotFound},
		"a malformed cursor":    {err: services.ErrInvalidCursor, want: connect.CodeInvalidArgument},
		"a terminal state":      {err: services.ErrConflict, want: connect.CodeFailedPrecondition},
		"an unreachable source": {err: services.ErrUnavailable, want: connect.CodeUnavailable},
		"a validation failure":  {err: &services.ValidationError{Field: "title", Reason: "must not be empty"}, want: connect.CodeInvalidArgument},
		"an unexpected failure": {err: errors.New("something broke"), want: connect.CodeInternal},
	} {
		t.Run(name, func(t *testing.T) {
			service := stubService{
				chat: func(_ context.Context, _, _ string) (services.Chat, []services.Message, string, error) {
					return services.Chat{}, nil, "", tc.err
				},
			}
			handler := chatshandlers.New(service)

			_, err := handler.GetChat(ownerContext(t, testAPIKey, "owner-1"), connect.NewRequest(&chatv1.GetChatRequest{ChatId: "chat-1"}))
			if connect.CodeOf(err) != tc.want {
				t.Fatalf("code = %v, want %v (err %v)", connect.CodeOf(err), tc.want, err)
			}
		})
	}
}

func TestTheValidationFailureReachesTheClient(t *testing.T) {
	service := stubService{
		renameChat: func(_ context.Context, _, _, _ string) (services.ChatSummary, error) {
			return services.ChatSummary{}, &services.ValidationError{Field: "title", Reason: "must not be empty"}
		},
	}
	handler := chatshandlers.New(service)

	_, err := handler.RenameChat(ownerContext(t, testAPIKey, "owner-1"), connect.NewRequest(&chatv1.RenameChatRequest{ChatId: "chat-1", Title: "  "}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("code = %v, want %v", connect.CodeOf(err), connect.CodeInvalidArgument)
	}
	if got := err.Error(); !strings.Contains(got, "title must not be empty") {
		t.Errorf("message = %q, want the validation reason", got)
	}
}

func TestTheHandlerRejectsACallWithoutAnOwner(t *testing.T) {
	called := false
	service := stubService{
		chat: func(_ context.Context, _, _ string) (services.Chat, []services.Message, string, error) {
			called = true
			return services.Chat{}, nil, "", nil
		},
	}
	handler := chatshandlers.New(service)

	_, err := handler.GetChat(context.Background(), connect.NewRequest(&chatv1.GetChatRequest{ChatId: "chat-1"}))
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("code = %v, want %v", connect.CodeOf(err), connect.CodeUnauthenticated)
	}
	if called {
		t.Error("the service was called without an owner")
	}
}

func TestTheAuthRejectsAMissingOrWrongAPIKey(t *testing.T) {
	messages := map[string]string{}
	for name, key := range map[string]string{
		"a missing key": "",
		"a wrong key":   "wrong-key-0123456789abcd",
	} {
		t.Run(name, func(t *testing.T) {
			req := connect.NewRequest(&chatv1.GetChatRequest{ChatId: "chat-1"})
			req.Header().Set("x-api-key", key)
			req.Header().Set("x-user-id", "owner-1")

			interceptor := chatshandlers.NewAuthInterceptor(testAPIKey)
			_, err := interceptor(func(context.Context, connect.AnyRequest) (connect.AnyResponse, error) {
				return nil, nil
			})(context.Background(), req)
			if connect.CodeOf(err) != connect.CodeUnauthenticated {
				t.Fatalf("code = %v, want %v", connect.CodeOf(err), connect.CodeUnauthenticated)
			}
			messages[name] = err.Error()
		})
	}
	if messages["a missing key"] != messages["a wrong key"] {
		t.Errorf("messages = %v, want the same answer for a missing and a wrong key", messages)
	}
}

func TestTheAuthRejectsAMissingUserID(t *testing.T) {
	req := connect.NewRequest(&chatv1.GetChatRequest{ChatId: "chat-1"})
	req.Header().Set("x-api-key", testAPIKey)

	interceptor := chatshandlers.NewAuthInterceptor(testAPIKey)
	_, err := interceptor(func(context.Context, connect.AnyRequest) (connect.AnyResponse, error) {
		return nil, nil
	})(context.Background(), req)
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("code = %v, want %v", connect.CodeOf(err), connect.CodeUnauthenticated)
	}
}
