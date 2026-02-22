package grpc

import (
	"context"

	pb "github.com/kunalPisolkar24/detectAI/services/chats/api/proto"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/core/domain"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/core/ports"
	"google.golang.org/grpc/codes"
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
	if req.UserId == "" {
		return nil, status.Error(codes.InvalidArgument, "user_id is required")
	}

	session, err := h.service.CreateSession(ctx, req.UserId, req.Title)
	if err != nil {
		return nil, status.Error(codes.Internal, err.Error())
	}

	return &pb.CreateChatResponse{ChatId: session.ID}, nil
}

func (h *Handler) GetChat(ctx context.Context, req *pb.GetChatRequest) (*pb.GetChatResponse, error) {
	session, err := h.service.GetSession(ctx, req.ChatId)
	if err != nil {
		return nil, status.Error(codes.NotFound, "Chat not found")
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
		return nil, status.Error(codes.Internal, err.Error())
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
	err := h.service.RenameSession(ctx, req.ChatId, req.NewTitle)
	if err != nil {
		return nil, status.Error(codes.Internal, err.Error())
	}
	return &pb.RenameChatResponse{Success: true}, nil
}

func (h *Handler) DeleteChat(ctx context.Context, req *pb.DeleteChatRequest) (*pb.DeleteChatResponse, error) {
	err := h.service.DeleteSession(ctx, req.ChatId)
	if err != nil {
		return nil, status.Error(codes.Internal, err.Error())
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
		return nil, status.Error(codes.Internal, err.Error())
	}

	return &pb.SaveMessageResponse{
		MessageId: msg.ID,
		Timestamp: msg.CreatedAt.Unix(),
	}, nil
}

func (h *Handler) GetChatHistory(ctx context.Context, req *pb.GetChatHistoryRequest) (*pb.GetChatHistoryResponse, error) {
	messages, hasMore, err := h.service.GetHistory(ctx, req.ChatId, req.Page, req.PageSize)
	if err != nil {
		return nil, status.Error(codes.Internal, err.Error())
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