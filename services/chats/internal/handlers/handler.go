// Package handlers implements the ChatService wire handler for the router.
package handlers

import (
	"context"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/types/known/emptypb"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/services"
	chatv1 "github.com/kunalPisolkar24/detectAI/services/chats/proto"
	chatv1connect "github.com/kunalPisolkar24/detectAI/services/chats/proto/chatv1connect"
)

// Handler serves the ChatService surface; the identity of every request comes
// from the auth interceptor.
type Handler struct {
	chatv1connect.UnimplementedChatServiceHandler
	service services.Service
}

func New(service services.Service) *Handler {
	return &Handler{service: service}
}

func (h *Handler) CreateChat(ctx context.Context, req *connect.Request[chatv1.CreateChatRequest]) (*connect.Response[chatv1.Chat], error) {
	ownerID, err := OwnerFrom(ctx)
	if err != nil {
		return nil, err
	}
	chat, err := h.service.CreateChat(ctx, ownerID, req.Msg.InitialMessage)
	if err != nil {
		return nil, toConnectError(err)
	}
	return connect.NewResponse(chatToProto(chat)), nil
}

func (h *Handler) GetChat(ctx context.Context, req *connect.Request[chatv1.GetChatRequest]) (*connect.Response[chatv1.Chat], error) {
	ownerID, err := OwnerFrom(ctx)
	if err != nil {
		return nil, err
	}
	chat, messages, cursor, err := h.service.GetChat(ctx, ownerID, req.Msg.ChatId)
	if err != nil {
		return nil, toConnectError(err)
	}
	protoChat := chatToProto(chat)
	for _, message := range messages {
		protoMessage, err := messageToProto(message)
		if err != nil {
			return nil, toConnectError(err)
		}
		protoChat.Messages = append(protoChat.Messages, protoMessage)
	}
	protoChat.NextCursor = cursor
	return connect.NewResponse(protoChat), nil
}

func (h *Handler) ListChats(ctx context.Context, req *connect.Request[chatv1.ListChatsRequest]) (*connect.Response[chatv1.ListChatsResponse], error) {
	ownerID, err := OwnerFrom(ctx)
	if err != nil {
		return nil, err
	}
	summaries, err := h.service.ListChats(ctx, ownerID, int(req.Msg.Limit))
	if err != nil {
		return nil, toConnectError(err)
	}
	response := &chatv1.ListChatsResponse{}
	for _, summary := range summaries {
		response.Chats = append(response.Chats, summaryToProto(summary))
	}
	return connect.NewResponse(response), nil
}

func (h *Handler) RenameChat(ctx context.Context, req *connect.Request[chatv1.RenameChatRequest]) (*connect.Response[chatv1.ChatSummary], error) {
	ownerID, err := OwnerFrom(ctx)
	if err != nil {
		return nil, err
	}
	summary, err := h.service.RenameChat(ctx, ownerID, req.Msg.ChatId, req.Msg.Title)
	if err != nil {
		return nil, toConnectError(err)
	}
	return connect.NewResponse(summaryToProto(summary)), nil
}

func (h *Handler) DeleteChat(ctx context.Context, req *connect.Request[chatv1.DeleteChatRequest]) (*connect.Response[emptypb.Empty], error) {
	ownerID, err := OwnerFrom(ctx)
	if err != nil {
		return nil, err
	}
	if err := h.service.DeleteChat(ctx, ownerID, req.Msg.ChatId); err != nil {
		return nil, toConnectError(err)
	}
	return connect.NewResponse(&emptypb.Empty{}), nil
}

func (h *Handler) SaveUserMessage(ctx context.Context, req *connect.Request[chatv1.SaveUserMessageRequest]) (*connect.Response[chatv1.Message], error) {
	ownerID, err := OwnerFrom(ctx)
	if err != nil {
		return nil, err
	}
	saved, err := h.service.SaveUserMessage(ctx, ownerID, req.Msg.ChatId, req.Msg.MessageId, req.Msg.Content, timestampOf(req.Msg.CreatedAt))
	if err != nil {
		return nil, toConnectError(err)
	}
	message, err := messageToProto(saved)
	if err != nil {
		return nil, toConnectError(err)
	}
	return connect.NewResponse(message), nil
}

func (h *Handler) SaveAnalysisMessage(ctx context.Context, req *connect.Request[chatv1.SaveAnalysisMessageRequest]) (*connect.Response[chatv1.Message], error) {
	ownerID, err := OwnerFrom(ctx)
	if err != nil {
		return nil, err
	}
	analysis, err := analysisFromProto(req.Msg.State, req.Msg.Model, req.Msg.SourceMessageId, req.Msg.Error, req.Msg.Analysis)
	if err != nil {
		return nil, toConnectError(err)
	}
	saved, err := h.service.SaveAnalysisMessage(ctx, ownerID, req.Msg.ChatId, req.Msg.MessageId, timestampOf(req.Msg.CreatedAt), analysis)
	if err != nil {
		return nil, toConnectError(err)
	}
	message, err := messageToProto(saved)
	if err != nil {
		return nil, toConnectError(err)
	}
	return connect.NewResponse(message), nil
}

func (h *Handler) GetChatHistory(ctx context.Context, req *connect.Request[chatv1.GetChatHistoryRequest]) (*connect.Response[chatv1.GetChatHistoryResponse], error) {
	ownerID, err := OwnerFrom(ctx)
	if err != nil {
		return nil, err
	}
	messages, cursor, err := h.service.GetChatHistory(ctx, ownerID, req.Msg.ChatId, req.Msg.Cursor, int(req.Msg.Limit))
	if err != nil {
		return nil, toConnectError(err)
	}
	response := &chatv1.GetChatHistoryResponse{NextCursor: cursor}
	for _, message := range messages {
		protoMessage, err := messageToProto(message)
		if err != nil {
			return nil, toConnectError(err)
		}
		response.Messages = append(response.Messages, protoMessage)
	}
	return connect.NewResponse(response), nil
}
