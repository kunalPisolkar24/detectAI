// Package core holds the chats business rules over the data access and the cache.
package core

import (
	"context"
	"log/slog"
	"time"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/cache"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/store"
)

// ChatService owns the chat business rules.
type ChatService struct {
	repo   store.Repository
	cache  cache.Entries
	logger *slog.Logger
}

// NewChatService builds the service over its data access and its cache.
func NewChatService(repo store.Repository, cache cache.Entries, logger *slog.Logger) *ChatService {
	return &ChatService{repo: repo, cache: cache, logger: logger}
}

// CreateChat opens a chat and stores the message that opened it.
func (s *ChatService) CreateChat(ctx context.Context, ownerID, initialMessage string) (store.Chat, error) {
	if err := store.ValidateContent(initialMessage); err != nil {
		return store.Chat{}, err
	}
	title := store.DeriveChatTitle(initialMessage)
	if err := store.ValidateChatTitle(title); err != nil {
		return store.Chat{}, err
	}

	chat, err := s.repo.CreateChat(ctx, ownerID, title)
	if err != nil {
		return store.Chat{}, err
	}
	if _, err := s.repo.SaveUserMessage(ctx, ownerID, store.Message{
		ChatID:  chat.ID,
		Role:    store.RoleUser,
		Content: initialMessage,
	}); err != nil {
		return store.Chat{}, err
	}
	s.invalidateOwner(ctx, ownerID)
	return chat, nil
}

// GetChat returns the chat meta with its head page and the cursor that chains
// to the next one.
func (s *ChatService) GetChat(ctx context.Context, ownerID, chatID string) (store.Chat, []store.Message, string, error) {
	if err := store.ValidateChatID(chatID); err != nil {
		return store.Chat{}, nil, "", err
	}
	chat, err := s.cachedChat(ctx, ownerID, chatID)
	if err != nil {
		return store.Chat{}, nil, "", err
	}
	page, err := s.headPage(ctx, ownerID, chatID, store.DefaultHistoryLimit)
	if err != nil {
		return store.Chat{}, nil, "", err
	}
	return chat, page.Messages, page.NextCursor, nil
}

// ListChats returns the owner's chats newest-first.
func (s *ChatService) ListChats(ctx context.Context, ownerID string, limit int) ([]store.ChatSummary, error) {
	return s.cachedList(ctx, ownerID, store.ClampChatsLimit(limit))
}

// RenameChat sets a chat's title.
func (s *ChatService) RenameChat(ctx context.Context, ownerID, chatID, title string) (store.ChatSummary, error) {
	if err := store.ValidateChatID(chatID); err != nil {
		return store.ChatSummary{}, err
	}
	if err := store.ValidateChatTitle(title); err != nil {
		return store.ChatSummary{}, err
	}
	summary, err := s.repo.RenameChat(ctx, ownerID, chatID, title)
	if err != nil {
		return store.ChatSummary{}, err
	}
	s.invalidateMeta(ctx, chatID, ownerID)
	return summary, nil
}

// DeleteChat deletes a chat and its messages.
func (s *ChatService) DeleteChat(ctx context.Context, ownerID, chatID string) error {
	if err := store.ValidateChatID(chatID); err != nil {
		return err
	}
	if err := s.repo.DeleteChat(ctx, ownerID, chatID); err != nil {
		return err
	}
	s.invalidateChat(ctx, chatID, ownerID)
	return nil
}

// SaveUserMessage stores a message the user sent.
func (s *ChatService) SaveUserMessage(ctx context.Context, ownerID, chatID, messageID, content string, createdAt time.Time) (store.Message, error) {
	message := store.Message{
		ID:        messageID,
		ChatID:    chatID,
		Role:      store.RoleUser,
		Content:   content,
		CreatedAt: createdAt,
	}
	if err := store.ValidateUserMessage(message); err != nil {
		return store.Message{}, err
	}
	saved, err := s.repo.SaveUserMessage(ctx, ownerID, message)
	if err != nil {
		return store.Message{}, err
	}
	s.invalidateChat(ctx, chatID, ownerID)
	return saved, nil
}

// SaveAnalysisMessage stores the analysis state of a message.
func (s *ChatService) SaveAnalysisMessage(ctx context.Context, ownerID, chatID, messageID string, createdAt time.Time, analysis *store.Analysis) (store.Message, error) {
	message := store.Message{
		ID:        messageID,
		ChatID:    chatID,
		Role:      store.RoleAssistant,
		CreatedAt: createdAt,
		Analysis:  analysis,
	}
	if err := store.ValidateAnalysisMessage(message); err != nil {
		return store.Message{}, err
	}
	saved, err := s.repo.SaveAnalysisMessage(ctx, ownerID, message)
	if err != nil {
		return store.Message{}, err
	}
	s.invalidateChat(ctx, chatID, ownerID)
	return saved, nil
}

// GetChatHistory pages a chat's history newest-first. The first page comes
// from the cache; the cursor pages read the source.
func (s *ChatService) GetChatHistory(ctx context.Context, ownerID, chatID, cursor string, limit int) ([]store.Message, string, error) {
	if err := store.ValidateChatID(chatID); err != nil {
		return nil, "", err
	}
	limit = store.ClampHistoryLimit(limit)
	if cursor != "" {
		messages, next, err := s.repo.ChatHistory(ctx, ownerID, chatID, cursor, limit)
		if err != nil {
			return nil, "", err
		}
		return messages, next, nil
	}
	if _, err := s.cachedChat(ctx, ownerID, chatID); err != nil {
		return nil, "", err
	}
	page, err := s.headPage(ctx, ownerID, chatID, limit)
	if err != nil {
		return nil, "", err
	}
	return page.Messages, page.NextCursor, nil
}
