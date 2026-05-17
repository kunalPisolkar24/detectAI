package grpc

import (
	"context"
	"errors"
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
	session, err := h.service.CreateSession(ctx, req.UserId, req.Title)
	if err != nil {
		return nil, h.mapError(err)
	}

	return &pb.CreateChatResponse{ChatId: session.ID}, nil
}

func (h *Handler) GetChat(ctx context.Context, req *pb.GetChatRequest) (*pb.GetChatResponse, error) {
	userID := h.extractUserID(ctx)
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
	chats, err := h.service.GetUserSessions(ctx, req.UserId)
	if err != nil {
		return nil, h.mapError(err)
	}

	summaries := make([]*pb.ChatSummary, len(chats))
	for i, c := range chats {
		summaries[i] = &pb.ChatSummary{
			Id:        c.ID,
			Title:     c.Title,
			UpdatedAt: c.UpdatedAt.Unix(),
		}
	}

	return &pb.GetUserChatsResponse{Chats: summaries}, nil
}

func (h *Handler) RenameChat(ctx context.Context, req *pb.RenameChatRequest) (*pb.RenameChatResponse, error) {
	userID := h.extractUserID(ctx)
	err := h.service.RenameSession(ctx, req.ChatId, userID, req.NewTitle)
	if err != nil {
		return nil, h.mapError(err)
	}
	return &pb.RenameChatResponse{Success: true}, nil
}

func (h *Handler) DeleteChat(ctx context.Context, req *pb.DeleteChatRequest) (*pb.DeleteChatResponse, error) {
	userID := h.extractUserID(ctx)
	err := h.service.DeleteSession(ctx, req.ChatId, userID)
	if err != nil {
		return nil, h.mapError(err)
	}
	return &pb.DeleteChatResponse{Success: true}, nil
}

func (h *Handler) SaveMessage(ctx context.Context, req *pb.SaveMessageRequest) (*pb.SaveMessageResponse, error) {
	msg := &domain.Message{
		ChatID:   req.ChatId,
		UserID:   req.UserId,
		Role:     req.Role,
		Content:  req.Content,
		Metadata: req.Metadata,
		ID:       req.MessageId,
	}

	if req.CreatedAt > 0 {
		msg.CreatedAt = time.Unix(req.CreatedAt, 0).UTC()
	}

	if req.Analysis != nil {
		msg.Analysis = &domain.AnalysisResult{
			HumanScore: req.Analysis.HumanScore,
			AIScore:    req.Analysis.AiScore,
			ModelName:  req.Analysis.ModelName,
			Verdict:    req.Analysis.Verdict,
		}
	}

	if err := h.service.ProcessMessage(ctx, msg); err != nil {
		return nil, h.mapError(err)
	}

	return &pb.SaveMessageResponse{
		MessageId: msg.ID,
		Timestamp: msg.CreatedAt.Unix(),
	}, nil
}

func (h *Handler) GetChatHistory(ctx context.Context, req *pb.GetChatHistoryRequest) (*pb.GetChatHistoryResponse, error) {
	userID := h.extractUserID(ctx)
	messages, hasMore, err := h.service.GetHistory(ctx, req.ChatId, userID, req.Page, req.PageSize)
	if err != nil {
		return nil, h.mapError(err)
	}

	pbMessages := make([]*pb.Message, len(messages))
	for i, m := range messages {
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
		return ids[0]
	}
	return ""
}
