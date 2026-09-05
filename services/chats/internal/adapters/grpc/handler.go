package grpc

import (
	"context"
	"errors"
	"strings"
	"time"

	pb "github.com/kunalPisolkar24/detectAI/services/chats/api/proto"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/core/domain"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/core/ports"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

type Handler struct {
	pb.UnimplementedChatServiceServer
	service ports.ChatService
}

func NewHandler(service ports.ChatService) *Handler {
	return &Handler{service: service}
}

func (h *Handler) CreateChat(ctx context.Context, req *pb.CreateChatRequest) (*pb.CreateChatResponse, error) {
	if req == nil {
		return nil, status.Error(codes.InvalidArgument, "request body is required")
	}
	userID, err := h.resolveUserID(ctx, req.UserId)
	if err != nil {
		return nil, err
	}
	session, svcErr := h.service.CreateSession(ctx, userID, req.Title)
	if svcErr != nil {
		return nil, h.mapError(svcErr)
	}

	return &pb.CreateChatResponse{ChatId: session.ID}, nil
}

func (h *Handler) GetChat(ctx context.Context, req *pb.GetChatRequest) (*pb.GetChatResponse, error) {
	if req == nil {
		return nil, status.Error(codes.InvalidArgument, "request body is required")
	}
	userID := h.extractUserID(ctx)
	if strings.TrimSpace(userID) == "" {
		return nil, status.Error(codes.Unauthenticated, "missing authentication: x-user-id header required")
	}
	if strings.TrimSpace(req.ChatId) == "" {
		return nil, status.Error(codes.InvalidArgument, "chat_id is required")
	}
	session, err := h.service.GetSession(ctx, req.ChatId, userID)
	if err != nil {
		return nil, h.mapError(err)
	}

	return &pb.GetChatResponse{
		Id:        session.ID,
		UserId:    session.UserID,
		Title:     session.Title,
		CreatedAt: session.CreatedAt.Unix(),
		UpdatedAt: session.UpdatedAt.Unix(),
	}, nil
}

func (h *Handler) GetUserChats(ctx context.Context, req *pb.GetUserChatsRequest) (*pb.GetUserChatsResponse, error) {
	if req == nil {
		return nil, status.Error(codes.InvalidArgument, "request body is required")
	}
	userID, err := h.resolveUserID(ctx, req.UserId)
	if err != nil {
		return nil, err
	}
	limit := int(req.Limit)
	if limit <= 0 {
		limit = 50
	}
	if limit > 100 {
		limit = 100
	}
	chats, svcErr := h.service.GetUserSessions(ctx, userID, limit)
	if svcErr != nil {
		return nil, h.mapError(svcErr)
	}

	summaries := make([]*pb.ChatSummary, len(chats))
	for i, c := range chats {
		if c == nil {
			continue
		}
		summaries[i] = &pb.ChatSummary{
			Id:        c.ID,
			Title:     c.Title,
			UpdatedAt: c.UpdatedAt.Unix(),
		}
	}

	return &pb.GetUserChatsResponse{Chats: summaries}, nil
}

func (h *Handler) RenameChat(ctx context.Context, req *pb.RenameChatRequest) (*pb.RenameChatResponse, error) {
	if req == nil {
		return nil, status.Error(codes.InvalidArgument, "request body is required")
	}
	userID := h.extractUserID(ctx)
	if strings.TrimSpace(userID) == "" {
		return nil, status.Error(codes.Unauthenticated, "missing authentication: x-user-id header required")
	}
	if strings.TrimSpace(req.ChatId) == "" {
		return nil, status.Error(codes.InvalidArgument, "chat_id is required")
	}
	if strings.TrimSpace(req.NewTitle) == "" {
		return nil, status.Error(codes.InvalidArgument, "new_title is required")
	}
	err := h.service.RenameSession(ctx, req.ChatId, userID, req.NewTitle)
	if err != nil {
		return nil, h.mapError(err)
	}
	return &pb.RenameChatResponse{Success: true}, nil
}

func (h *Handler) DeleteChat(ctx context.Context, req *pb.DeleteChatRequest) (*pb.DeleteChatResponse, error) {
	if req == nil {
		return nil, status.Error(codes.InvalidArgument, "request body is required")
	}
	userID := h.extractUserID(ctx)
	if strings.TrimSpace(userID) == "" {
		return nil, status.Error(codes.Unauthenticated, "missing authentication: x-user-id header required")
	}
	if strings.TrimSpace(req.ChatId) == "" {
		return nil, status.Error(codes.InvalidArgument, "chat_id is required")
	}
	err := h.service.DeleteSession(ctx, req.ChatId, userID)
	if err != nil {
		return nil, h.mapError(err)
	}
	return &pb.DeleteChatResponse{Success: true}, nil
}

func (h *Handler) SaveMessage(ctx context.Context, req *pb.SaveMessageRequest) (*pb.SaveMessageResponse, error) {
	if req == nil {
		return nil, status.Error(codes.InvalidArgument, "request body is required")
	}
	userID, err := h.resolveUserID(ctx, req.UserId)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(req.ChatId) == "" {
		return nil, status.Error(codes.InvalidArgument, "chat_id is required")
	}
	if strings.TrimSpace(req.Content) == "" {
		return nil, status.Error(codes.InvalidArgument, "content is required")
	}

	msg := &domain.Message{
		ChatID:   strings.TrimSpace(req.ChatId),
		UserID:   userID,
		Role:     strings.TrimSpace(req.Role),
		Content:  req.Content, // service will trim and validate length
		Metadata: req.Metadata,
		ID:       strings.TrimSpace(req.MessageId),
	}

	if req.CreatedAt > 0 {
		msg.CreatedAt = parseTimestamp(req.CreatedAt)
	}

	if req.Analysis != nil {
		msg.Analysis = &domain.AnalysisResult{
			HumanScore: req.Analysis.HumanScore,
			AIScore:    req.Analysis.AiScore,
			ModelName:  strings.TrimSpace(req.Analysis.ModelName),
			Verdict:    strings.TrimSpace(req.Analysis.Verdict),
		}
	}

	if svcErr := h.service.ProcessMessage(ctx, msg); svcErr != nil {
		return nil, h.mapError(svcErr)
	}

	return &pb.SaveMessageResponse{
		MessageId: msg.ID,
		Timestamp: msg.CreatedAt.Unix(),
	}, nil
}

func (h *Handler) GetChatHistory(ctx context.Context, req *pb.GetChatHistoryRequest) (*pb.GetChatHistoryResponse, error) {
	if req == nil {
		return nil, status.Error(codes.InvalidArgument, "request body is required")
	}
	userID := h.extractUserID(ctx)
	if strings.TrimSpace(userID) == "" {
		return nil, status.Error(codes.Unauthenticated, "missing authentication: x-user-id header required")
	}
	if strings.TrimSpace(req.ChatId) == "" {
		return nil, status.Error(codes.InvalidArgument, "chat_id is required")
	}
	messages, hasMore, err := h.service.GetHistory(ctx, req.ChatId, userID, req.Page, req.PageSize)
	if err != nil {
		return nil, h.mapError(err)
	}

	pbMessages := make([]*pb.Message, len(messages))
	for i, m := range messages {
		if m == nil {
			continue
		}
		var analysis *pb.Analysis
		if m.Analysis != nil {
			analysis = &pb.Analysis{
				HumanScore: m.Analysis.HumanScore,
				AiScore:    m.Analysis.AIScore,
				ModelName:  m.Analysis.ModelName,
				Verdict:    m.Analysis.Verdict,
			}
		}

		pbMessages[i] = &pb.Message{
			Id:        m.ID,
			ChatId:    m.ChatID,
			UserId:    m.UserID,
			Role:      m.Role,
			Content:   m.Content,
			CreatedAt: m.CreatedAt.Unix(),
			Metadata:  m.Metadata,
			Analysis:  analysis,
		}
	}

	return &pb.GetChatHistoryResponse{
		Messages: pbMessages,
		HasMore:  hasMore,
	}, nil
}

func (h *Handler) mapError(err error) error {
	if errors.Is(err, context.DeadlineExceeded) {
		return status.Error(codes.DeadlineExceeded, "request deadline exceeded")
	}
	if errors.Is(err, context.Canceled) {
		return status.Error(codes.Canceled, "request canceled")
	}
	if errors.Is(err, domain.ErrNotFound) {
		return status.Error(codes.NotFound, err.Error())
	}
	if errors.Is(err, domain.ErrUnauthorized) {
		return status.Error(codes.PermissionDenied, err.Error())
	}
	if errors.Is(err, domain.ErrInvalidInput) {
		return status.Error(codes.InvalidArgument, err.Error())
	}
	return status.Error(codes.Internal, "internal server error")
}

func (h *Handler) extractUserID(ctx context.Context) string {
	md, ok := metadata.FromIncomingContext(ctx)
	if !ok {
		return ""
	}
	ids := md.Get("x-user-id")
	if len(ids) > 0 {
		return strings.TrimSpace(ids[0])
	}
	// Also support lowercase variant for compatibility with some gateways
	ids = md.Get("x-user-ID")
	if len(ids) > 0 {
		return strings.TrimSpace(ids[0])
	}
	return ""
}

// resolveUserID prefers the authenticated header. If the header is present it must match
// the body user_id when both are supplied; if header is absent the body is accepted for
// backward compatibility. An empty result after resolution is treated as unauthenticated.
func (h *Handler) resolveUserID(ctx context.Context, bodyUserID string) (string, error) {
	headerID := h.extractUserID(ctx)
	bodyID := strings.TrimSpace(bodyUserID)
	headerID = strings.TrimSpace(headerID)

	if headerID != "" {
		if bodyID != "" && bodyID != headerID {
			return "", status.Error(codes.PermissionDenied, "user_id mismatch between header and body")
		}
		return headerID, nil
	}
	if bodyID != "" {
		return bodyID, nil
	}
	return "", status.Error(codes.Unauthenticated, "missing authentication: x-user-id header or user_id field required")
}

// parseTimestamp handles both seconds and milliseconds epoch values.
// Values > 1e11 are interpreted as milliseconds to protect against client confusion.
// Values beyond year 2100 in seconds are also treated as milliseconds.
func parseTimestamp(ts int64) time.Time {
	// Current epoch seconds ~1.7e9, millis ~1.7e12
	// Threshold 1e11 = 5138-11-16 in seconds, so any seconds value above that must be millis.
	if ts > 1e11 {
		// Could be milliseconds or microseconds; heuristically treat >1e14 as microseconds
		if ts > 1e14 {
			// microseconds
			return time.Unix(ts/1e6, (ts%1e6)*1000).UTC()
		}
		return time.UnixMilli(ts).UTC()
	}
	return time.Unix(ts, 0).UTC()
}
