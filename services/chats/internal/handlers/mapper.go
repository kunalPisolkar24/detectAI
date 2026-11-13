package handlers

import (
	"time"

	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/models"
	chatv1 "github.com/kunalPisolkar24/detectAI/services/chats/proto"
)

// chatToProto maps a chat meta onto the wire.
func chatToProto(chat models.Chat) *chatv1.Chat {
	return &chatv1.Chat{
		Id:        chat.ID,
		Title:     chat.Title,
		CreatedAt: timestamppb.New(chat.CreatedAt),
		UpdatedAt: timestamppb.New(chat.UpdatedAt),
	}
}

// summaryToProto maps a chat summary onto the wire.
func summaryToProto(summary models.ChatSummary) *chatv1.ChatSummary {
	return &chatv1.ChatSummary{
		Id:        summary.ID,
		Title:     summary.Title,
		UpdatedAt: timestamppb.New(summary.UpdatedAt),
	}
}

// messageToProto maps a message onto the wire.
func messageToProto(message models.Message) (*chatv1.Message, error) {
	analysis, err := analysisToProto(message.Analysis)
	if err != nil {
		return nil, err
	}
	return &chatv1.Message{
		Id:        message.ID,
		ChatId:    message.ChatID,
		Role:      roleToProto(message.Role),
		Content:   message.Content,
		Analysis:  analysis,
		CreatedAt: timestamppb.New(message.CreatedAt),
	}, nil
}

// analysisToProto maps an analysis payload onto the wire.
func analysisToProto(analysis *models.Analysis) (*chatv1.Analysis, error) {
	if analysis == nil {
		return nil, nil
	}
	result, err := resultToProto(analysis.Result)
	if err != nil {
		return nil, err
	}
	return &chatv1.Analysis{
		State:           stateToProto(analysis.State),
		Model:           modelToProto(analysis.Model),
		SourceMessageId: analysis.SourceMessageID,
		Error:           analysis.Error,
		Result:          result,
	}, nil
}

// resultToProto maps a detection verdict onto the wire.
func resultToProto(result *models.AnalysisResult) (*chatv1.AnalysisResult, error) {
	if result == nil {
		return nil, nil
	}
	proto := &chatv1.AnalysisResult{
		Label:      labelToProto(result.Label),
		Confidence: result.Confidence,
		Scores:     &chatv1.Scores{Ai: result.Scores.AI, Human: result.Scores.Human},
	}
	for _, highlight := range result.Highlights {
		proto.Highlights = append(proto.Highlights, &chatv1.Highlight{
			CharStart:    highlight.CharStart,
			CharEnd:      highlight.CharEnd,
			AiConfidence: highlight.AIConfidence,
			Label:        labelToProto(highlight.Label),
		})
	}
	if result.Raw != nil {
		raw, err := structpb.NewStruct(result.Raw)
		if err != nil {
			return nil, err
		}
		proto.Raw = raw
	}
	return proto, nil
}

// analysisFromProto maps the request's analysis payload onto the domain.
func analysisFromProto(state chatv1.AnalysisState, model chatv1.Model, sourceMessageID, analysisError string, result *chatv1.AnalysisResult) (*models.Analysis, error) {
	analysis := &models.Analysis{
		State:           stateFromProto(state),
		Model:           modelFromProto(model),
		SourceMessageID: sourceMessageID,
		Error:           analysisError,
	}
	if result != nil {
		analysis.Result = resultFromProto(result)
	}
	return analysis, nil
}

// resultFromProto maps a wire verdict onto the domain.
func resultFromProto(result *chatv1.AnalysisResult) *models.AnalysisResult {
	converted := &models.AnalysisResult{
		Label:      labelFromProto(result.Label),
		Confidence: result.Confidence,
	}
	if result.Scores != nil {
		converted.Scores = models.Scores{AI: result.Scores.Ai, Human: result.Scores.Human}
	}
	for _, highlight := range result.Highlights {
		converted.Highlights = append(converted.Highlights, models.Highlight{
			CharStart:    highlight.CharStart,
			CharEnd:      highlight.CharEnd,
			AIConfidence: highlight.AiConfidence,
			Label:        labelFromProto(highlight.Label),
		})
	}
	if result.Raw != nil {
		converted.Raw = result.Raw.AsMap()
	}
	return converted
}

// roleToProto maps a message author onto the wire.
func roleToProto(role models.Role) chatv1.Role {
	switch role {
	case models.RoleUser:
		return chatv1.Role_ROLE_USER
	case models.RoleAssistant:
		return chatv1.Role_ROLE_ASSISTANT
	default:
		return chatv1.Role_ROLE_UNSPECIFIED
	}
}

// stateToProto maps an analysis state onto the wire.
func stateToProto(state models.AnalysisState) chatv1.AnalysisState {
	switch state {
	case models.StateRunning:
		return chatv1.AnalysisState_ANALYSIS_STATE_RUNNING
	case models.StateCompleted:
		return chatv1.AnalysisState_ANALYSIS_STATE_COMPLETED
	case models.StateFailed:
		return chatv1.AnalysisState_ANALYSIS_STATE_FAILED
	case models.StateCancelled:
		return chatv1.AnalysisState_ANALYSIS_STATE_CANCELLED
	default:
		return chatv1.AnalysisState_ANALYSIS_STATE_UNSPECIFIED
	}
}

// modelToProto maps an inference model onto the wire.
func modelToProto(model models.Model) chatv1.Model {
	switch model {
	case models.ModelSpark:
		return chatv1.Model_MODEL_SPARK
	case models.ModelFlare:
		return chatv1.Model_MODEL_FLARE
	default:
		return chatv1.Model_MODEL_UNSPECIFIED
	}
}

// labelToProto maps a detection verdict onto the wire.
func labelToProto(label models.Label) chatv1.Label {
	switch label {
	case models.LabelAI:
		return chatv1.Label_LABEL_AI
	case models.LabelHuman:
		return chatv1.Label_LABEL_HUMAN
	default:
		return chatv1.Label_LABEL_UNSPECIFIED
	}
}

// stateFromProto maps an analysis state off the wire; an unspecified state
// stays empty and the domain validator rejects it.
func stateFromProto(state chatv1.AnalysisState) models.AnalysisState {
	switch state {
	case chatv1.AnalysisState_ANALYSIS_STATE_RUNNING:
		return models.StateRunning
	case chatv1.AnalysisState_ANALYSIS_STATE_COMPLETED:
		return models.StateCompleted
	case chatv1.AnalysisState_ANALYSIS_STATE_FAILED:
		return models.StateFailed
	case chatv1.AnalysisState_ANALYSIS_STATE_CANCELLED:
		return models.StateCancelled
	default:
		return ""
	}
}

// modelFromProto maps an inference model off the wire.
func modelFromProto(model chatv1.Model) models.Model {
	switch model {
	case chatv1.Model_MODEL_SPARK:
		return models.ModelSpark
	case chatv1.Model_MODEL_FLARE:
		return models.ModelFlare
	default:
		return ""
	}
}

// labelFromProto maps a detection verdict off the wire.
func labelFromProto(label chatv1.Label) models.Label {
	switch label {
	case chatv1.Label_LABEL_AI:
		return models.LabelAI
	case chatv1.Label_LABEL_HUMAN:
		return models.LabelHuman
	default:
		return ""
	}
}

// timestampOf reads an optional wire timestamp; an absent one is the zero time.
func timestampOf(ts *timestamppb.Timestamp) time.Time {
	if ts == nil {
		return time.Time{}
	}
	return ts.AsTime()
}
