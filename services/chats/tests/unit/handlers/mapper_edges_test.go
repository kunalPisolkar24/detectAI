package handlers_test

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"

	chatshandlers "github.com/kunalPisolkar24/detectAI/services/chats/internal/handlers"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/models"
	chatv1 "github.com/kunalPisolkar24/detectAI/services/chats/proto"
)

func TestEveryRPCRejectsAMissingOwner(t *testing.T) {
	handler := chatshandlers.New(stubService{})
	ctx := context.Background()

	calls := map[string]func() error{
		"CreateChat": func() error {
			_, err := handler.CreateChat(ctx, connect.NewRequest(&chatv1.CreateChatRequest{}))
			return err
		},
		"GetChat": func() error {
			_, err := handler.GetChat(ctx, connect.NewRequest(&chatv1.GetChatRequest{}))
			return err
		},
		"ListChats": func() error {
			_, err := handler.ListChats(ctx, connect.NewRequest(&chatv1.ListChatsRequest{}))
			return err
		},
		"RenameChat": func() error {
			_, err := handler.RenameChat(ctx, connect.NewRequest(&chatv1.RenameChatRequest{}))
			return err
		},
		"DeleteChat": func() error {
			_, err := handler.DeleteChat(ctx, connect.NewRequest(&chatv1.DeleteChatRequest{}))
			return err
		},
		"SaveUserMessage": func() error {
			_, err := handler.SaveUserMessage(ctx, connect.NewRequest(&chatv1.SaveUserMessageRequest{}))
			return err
		},
		"SaveAnalysisMessage": func() error {
			_, err := handler.SaveAnalysisMessage(ctx, connect.NewRequest(&chatv1.SaveAnalysisMessageRequest{}))
			return err
		},
		"GetChatHistory": func() error {
			_, err := handler.GetChatHistory(ctx, connect.NewRequest(&chatv1.GetChatHistoryRequest{}))
			return err
		},
	}
	for name, call := range calls {
		t.Run(name, func(t *testing.T) {
			if err := call(); connect.CodeOf(err) != connect.CodeUnauthenticated {
				t.Fatalf("code = %v, want %v (err %v)", connect.CodeOf(err), connect.CodeUnauthenticated, err)
			}
		})
	}
}

func TestEveryRPCSurfacesAServiceFailure(t *testing.T) {
	handler := chatshandlers.New(stubService{
		createChat: func(context.Context, string, string) (models.Chat, error) {
			return models.Chat{}, models.ErrUnavailable
		},
		chat: func(context.Context, string, string) (models.Chat, []models.Message, string, error) {
			return models.Chat{}, nil, "", models.ErrUnavailable
		},
		chats: func(context.Context, string, int) ([]models.ChatSummary, error) {
			return nil, models.ErrUnavailable
		},
		renameChat: func(context.Context, string, string, string) (models.ChatSummary, error) {
			return models.ChatSummary{}, models.ErrUnavailable
		},
		deleteChat: func(context.Context, string, string) error {
			return models.ErrUnavailable
		},
		saveUserMessage: func(context.Context, string, string, string, string, time.Time) (models.Message, error) {
			return models.Message{}, models.ErrUnavailable
		},
		saveAnalysisMessage: func(context.Context, string, string, string, time.Time, *models.Analysis) (models.Message, error) {
			return models.Message{}, models.ErrUnavailable
		},
		chatHistory: func(context.Context, string, string, string, int) ([]models.Message, string, error) {
			return nil, "", models.ErrUnavailable
		},
	})
	ctx := ownerContext(t, testAPIKey, "owner-1")

	calls := map[string]func() error{
		"CreateChat": func() error {
			_, err := handler.CreateChat(ctx, connect.NewRequest(&chatv1.CreateChatRequest{}))
			return err
		},
		"GetChat": func() error {
			_, err := handler.GetChat(ctx, connect.NewRequest(&chatv1.GetChatRequest{}))
			return err
		},
		"ListChats": func() error {
			_, err := handler.ListChats(ctx, connect.NewRequest(&chatv1.ListChatsRequest{}))
			return err
		},
		"RenameChat": func() error {
			_, err := handler.RenameChat(ctx, connect.NewRequest(&chatv1.RenameChatRequest{}))
			return err
		},
		"DeleteChat": func() error {
			_, err := handler.DeleteChat(ctx, connect.NewRequest(&chatv1.DeleteChatRequest{}))
			return err
		},
		"SaveUserMessage": func() error {
			_, err := handler.SaveUserMessage(ctx, connect.NewRequest(&chatv1.SaveUserMessageRequest{}))
			return err
		},
		"SaveAnalysisMessage": func() error {
			_, err := handler.SaveAnalysisMessage(ctx, connect.NewRequest(&chatv1.SaveAnalysisMessageRequest{}))
			return err
		},
		"GetChatHistory": func() error {
			_, err := handler.GetChatHistory(ctx, connect.NewRequest(&chatv1.GetChatHistoryRequest{}))
			return err
		},
	}
	for name, call := range calls {
		t.Run(name, func(t *testing.T) {
			if err := call(); connect.CodeOf(err) != connect.CodeUnavailable {
				t.Fatalf("code = %v, want %v (err %v)", connect.CodeOf(err), connect.CodeUnavailable, err)
			}
		})
	}
}

func TestMapperFallsBackForUnknownEnums(t *testing.T) {
	var captured *models.Analysis
	service := stubService{
		saveAnalysisMessage: func(_ context.Context, _, chatID, messageID string, _ time.Time, analysis *models.Analysis) (models.Message, error) {
			captured = analysis
			return models.Message{
				ID: messageID, ChatID: chatID, Role: models.Role("unknown"), CreatedAt: time.Time{},
				Analysis: &models.Analysis{
					State: models.AnalysisState("unknown"), Model: models.Model("unknown"),
					Result: &models.AnalysisResult{Label: models.Label("unknown")},
				},
			}, nil
		},
	}
	handler := chatshandlers.New(service)

	req := connect.NewRequest(&chatv1.SaveAnalysisMessageRequest{
		State: chatv1.AnalysisState(99),
		Model: chatv1.Model(99),
		Analysis: &chatv1.AnalysisResult{
			Label: chatv1.Label(99),
		},
	})
	resp, err := handler.SaveAnalysisMessage(ownerContext(t, testAPIKey, "owner-1"), req)
	if err != nil {
		t.Fatalf("SaveAnalysisMessage: %v", err)
	}
	if captured.State != "" || captured.Model != "" || captured.Result.Label != "" {
		t.Errorf("incoming enums = %q/%q/%q, want the empty domain values", captured.State, captured.Model, captured.Result.Label)
	}
	if resp.Msg.Role != chatv1.Role_ROLE_UNSPECIFIED {
		t.Errorf("role = %v, want the unspecified fallback", resp.Msg.Role)
	}
	if resp.Msg.Analysis.State != chatv1.AnalysisState_ANALYSIS_STATE_UNSPECIFIED ||
		resp.Msg.Analysis.Model != chatv1.Model_MODEL_UNSPECIFIED ||
		resp.Msg.Analysis.Result.Label != chatv1.Label_LABEL_UNSPECIFIED {
		t.Errorf("outgoing enums = %+v, want unspecified fallbacks", resp.Msg.Analysis)
	}
}

func TestMapperRoundTripsRawAndHighlights(t *testing.T) {
	raw, err := structpb.NewStruct(map[string]any{"verdict": "ai"})
	if err != nil {
		t.Fatal(err)
	}
	service := stubService{
		saveAnalysisMessage: func(_ context.Context, _, chatID, messageID string, _ time.Time, analysis *models.Analysis) (models.Message, error) {
			return models.Message{
				ID: messageID, ChatID: chatID, Role: models.RoleAssistant,
				Analysis: &models.Analysis{
					State: models.StateCompleted, Model: models.ModelFlare,
					Result: &models.AnalysisResult{
						Label: models.LabelHuman, Confidence: 0.4,
						Scores:     models.Scores{AI: 0.4, Human: 0.6},
						Highlights: []models.Highlight{{CharStart: 1, CharEnd: 3, AIConfidence: 0.7, Label: models.LabelAI}},
						Raw:        map[string]any{"verdict": "human"},
					},
				},
			}, nil
		},
	}
	handler := chatshandlers.New(service)

	req := connect.NewRequest(&chatv1.SaveAnalysisMessageRequest{
		State: chatv1.AnalysisState_ANALYSIS_STATE_COMPLETED,
		Model: chatv1.Model_MODEL_FLARE,
		Analysis: &chatv1.AnalysisResult{
			Label:      chatv1.Label_LABEL_HUMAN,
			Confidence: 0.4,
			Highlights: []*chatv1.Highlight{{CharStart: 1, CharEnd: 3, AiConfidence: 0.7, Label: chatv1.Label_LABEL_AI}},
			Raw:        raw,
		},
	})
	resp, err := handler.SaveAnalysisMessage(ownerContext(t, testAPIKey, "owner-1"), req)
	if err != nil {
		t.Fatalf("SaveAnalysisMessage: %v", err)
	}
	if len(resp.Msg.Analysis.Result.Highlights) != 1 || resp.Msg.Analysis.Result.Highlights[0].Label != chatv1.Label_LABEL_AI {
		t.Errorf("highlights = %+v, want the mapping to survive the wire", resp.Msg.Analysis.Result.Highlights)
	}
	if got := resp.Msg.Analysis.Result.Raw.AsMap()["verdict"]; got != "human" {
		t.Errorf("raw verdict = %v, want the stored value", got)
	}
}

func TestMapperRejectsAnUnserialisableRawPayload(t *testing.T) {
	service := stubService{
		saveAnalysisMessage: func(_ context.Context, _, chatID, messageID string, _ time.Time, analysis *models.Analysis) (models.Message, error) {
			return models.Message{
				ID: messageID, ChatID: chatID,
				Analysis: &models.Analysis{
					State:  models.StateCompleted,
					Result: &models.AnalysisResult{Raw: map[string]any{"bad": make(chan int)}},
				},
			}, nil
		},
	}
	handler := chatshandlers.New(service)

	_, err := handler.SaveAnalysisMessage(ownerContext(t, testAPIKey, "owner-1"), connect.NewRequest(&chatv1.SaveAnalysisMessageRequest{}))
	if connect.CodeOf(err) != connect.CodeInternal {
		t.Fatalf("code = %v, want %v (err %v)", connect.CodeOf(err), connect.CodeInternal, err)
	}
}

func TestMapperFaultsFromEveryMessageRPC(t *testing.T) {
	bad := models.Message{Analysis: &models.Analysis{
		State:  models.StateCompleted,
		Result: &models.AnalysisResult{Raw: map[string]any{"bad": make(chan int)}},
	}}
	handler := chatshandlers.New(stubService{
		chat: func(context.Context, string, string) (models.Chat, []models.Message, string, error) {
			return models.Chat{}, []models.Message{bad}, "", nil
		},
		saveUserMessage: func(context.Context, string, string, string, string, time.Time) (models.Message, error) {
			return bad, nil
		},
		chatHistory: func(context.Context, string, string, string, int) ([]models.Message, string, error) {
			return []models.Message{bad}, "", nil
		},
	})
	ctx := ownerContext(t, testAPIKey, "owner-1")

	for name, call := range map[string]func() error{
		"GetChat": func() error {
			_, err := handler.GetChat(ctx, connect.NewRequest(&chatv1.GetChatRequest{}))
			return err
		},
		"SaveUserMessage": func() error {
			_, err := handler.SaveUserMessage(ctx, connect.NewRequest(&chatv1.SaveUserMessageRequest{}))
			return err
		},
		"GetChatHistory": func() error {
			_, err := handler.GetChatHistory(ctx, connect.NewRequest(&chatv1.GetChatHistoryRequest{}))
			return err
		},
	} {
		t.Run(name, func(t *testing.T) {
			if err := call(); connect.CodeOf(err) != connect.CodeInternal {
				t.Fatalf("code = %v, want %v (err %v)", connect.CodeOf(err), connect.CodeInternal, err)
			}
		})
	}
}

func TestMapperCoversEveryAnalysisState(t *testing.T) {
	for _, state := range []struct {
		wire chatv1.AnalysisState
		want models.AnalysisState
	}{
		{wire: chatv1.AnalysisState_ANALYSIS_STATE_FAILED, want: models.StateFailed},
		{wire: chatv1.AnalysisState_ANALYSIS_STATE_CANCELLED, want: models.StateCancelled},
	} {
		t.Run(state.wire.String(), func(t *testing.T) {
			var captured models.AnalysisState
			service := stubService{
				saveAnalysisMessage: func(_ context.Context, _, _, _ string, _ time.Time, analysis *models.Analysis) (models.Message, error) {
					captured = analysis.State
					return models.Message{Analysis: &models.Analysis{State: analysis.State}}, nil
				},
			}
			handler := chatshandlers.New(service)

			resp, err := handler.SaveAnalysisMessage(ownerContext(t, testAPIKey, "owner-1"),
				connect.NewRequest(&chatv1.SaveAnalysisMessageRequest{State: state.wire, Error: "stopped"}))
			if err != nil {
				t.Fatalf("SaveAnalysisMessage: %v", err)
			}
			if captured != state.want {
				t.Errorf("mapped state = %q, want %q", captured, state.want)
			}
			if resp.Msg.Analysis.State != state.wire {
				t.Errorf("wire state = %v, want %v", resp.Msg.Analysis.State, state.wire)
			}
		})
	}
}

func TestSaveAnalysisMessageMapsAnExplicitTimestamp(t *testing.T) {
	createdAt := time.Date(2026, 3, 4, 5, 6, 7, 0, time.UTC)
	var captured time.Time
	service := stubService{
		saveAnalysisMessage: func(_ context.Context, _, _, _ string, at time.Time, _ *models.Analysis) (models.Message, error) {
			captured = at
			return models.Message{}, nil
		},
	}
	handler := chatshandlers.New(service)

	_, err := handler.SaveAnalysisMessage(ownerContext(t, testAPIKey, "owner-1"),
		connect.NewRequest(&chatv1.SaveAnalysisMessageRequest{CreatedAt: timestamppb.New(createdAt)}))
	if err != nil {
		t.Fatalf("SaveAnalysisMessage: %v", err)
	}
	if !captured.Equal(createdAt) {
		t.Errorf("createdAt = %v, want %v", captured, createdAt)
	}
}

func TestSaveAnalysisMessageUsesZeroTimeForAnAbsentTimestamp(t *testing.T) {
	var createdAt time.Time
	service := stubService{
		saveAnalysisMessage: func(_ context.Context, _, _, _ string, at time.Time, _ *models.Analysis) (models.Message, error) {
			createdAt = at
			return models.Message{}, nil
		},
	}
	handler := chatshandlers.New(service)

	if _, err := handler.SaveAnalysisMessage(ownerContext(t, testAPIKey, "owner-1"), connect.NewRequest(&chatv1.SaveAnalysisMessageRequest{})); err != nil {
		t.Fatalf("SaveAnalysisMessage: %v", err)
	}
	if !createdAt.IsZero() {
		t.Errorf("createdAt = %v, want the zero time for an absent timestamp", createdAt)
	}
}
