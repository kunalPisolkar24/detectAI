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

func (h *Handler) SaveMessage(ctx context.Context, req *pb.SaveMessageRequest) (*pb.SaveMessageResponse, error) {
	msg := &domain.Message{
		ChatID:   req.ChatId,
		UserID:   req.UserId,
		Role:     req.Role,
		Content:  req.Content,
		Metadata: req.Metadata,
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
		pbMessages[i] = &pb.Message{
			Id:        m.ID,
			ChatId:    m.ChatID,
			UserId:    m.UserID,
			Role:      m.Role,
			Content:   m.Content,
			CreatedAt: m.CreatedAt.Unix(),
			Metadata:  m.Metadata,
		}
	}

	return &pb.GetChatHistoryResponse{
		Messages: pbMessages,
		HasMore:  hasMore,
	}, nil
}
