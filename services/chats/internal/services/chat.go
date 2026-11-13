package services

import (
	"context"
	"time"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/models"
)

func (s *ChatService) CreateChat(ctx context.Context, ownerID, initialMessage string) (models.Chat, error) {
	if err := ValidateContent(initialMessage); err != nil {
		return models.Chat{}, err
	}
	title := DeriveChatTitle(initialMessage)
	if err := ValidateChatTitle(title); err != nil {
		return models.Chat{}, err
	}

	chat, err := s.repo.CreateChat(ctx, ownerID, title)
	if err != nil {
		return models.Chat{}, err
	}
	if _, err := s.repo.SaveUserMessage(ctx, ownerID, models.Message{
		ChatID:  chat.ID,
		Role:    models.RoleUser,
		Content: initialMessage,
	}); err != nil {
		return models.Chat{}, err
	}
	s.invalidateOwner(ctx, ownerID)
	return chat, nil
}

// GetChat returns the chat meta with its head page and the cursor that
// chains to the next one.
func (s *ChatService) GetChat(ctx context.Context, ownerID, chatID string) (models.Chat, []models.Message, string, error) {
	if err := ValidateChatID(chatID); err != nil {
		return models.Chat{}, nil, "", err
	}
	chat, err := s.cachedChat(ctx, ownerID, chatID)
	if err != nil {
		return models.Chat{}, nil, "", err
	}
	page, err := s.headPage(ctx, ownerID, chatID, models.DefaultHistoryLimit)
	if err != nil {
		return models.Chat{}, nil, "", err
	}
	return chat, page.Messages, page.NextCursor, nil
}

func (s *ChatService) ListChats(ctx context.Context, ownerID string, limit int) ([]models.ChatSummary, error) {
	return s.cachedList(ctx, ownerID, models.ClampChatsLimit(limit))
}

func (s *ChatService) RenameChat(ctx context.Context, ownerID, chatID, title string) (models.ChatSummary, error) {
	if err := ValidateChatID(chatID); err != nil {
		return models.ChatSummary{}, err
	}
	if err := ValidateChatTitle(title); err != nil {
		return models.ChatSummary{}, err
	}
	summary, err := s.repo.RenameChat(ctx, ownerID, chatID, title)
	if err != nil {
		return models.ChatSummary{}, err
	}
	s.invalidateMeta(ctx, chatID, ownerID)
	return summary, nil
}

func (s *ChatService) DeleteChat(ctx context.Context, ownerID, chatID string) error {
	if err := ValidateChatID(chatID); err != nil {
		return err
	}
	if err := s.repo.DeleteChat(ctx, ownerID, chatID); err != nil {
		return err
	}
	s.invalidateChat(ctx, chatID, ownerID)
	return nil
}

func (s *ChatService) SaveUserMessage(ctx context.Context, ownerID, chatID, messageID, content string, createdAt time.Time) (models.Message, error) {
	message := models.Message{
		ID:        messageID,
		ChatID:    chatID,
		Role:      models.RoleUser,
		Content:   content,
		CreatedAt: createdAt,
	}
	if err := ValidateUserMessage(message); err != nil {
		return models.Message{}, err
	}
	saved, err := s.repo.SaveUserMessage(ctx, ownerID, message)
	if err != nil {
		return models.Message{}, err
	}
	s.invalidateChat(ctx, chatID, ownerID)
	return saved, nil
}

func (s *ChatService) SaveAnalysisMessage(ctx context.Context, ownerID, chatID, messageID string, createdAt time.Time, analysis *models.Analysis) (models.Message, error) {
	message := models.Message{
		ID:        messageID,
		ChatID:    chatID,
		Role:      models.RoleAssistant,
		CreatedAt: createdAt,
		Analysis:  analysis,
	}
	if err := ValidateAnalysisMessage(message); err != nil {
		return models.Message{}, err
	}
	saved, err := s.repo.SaveAnalysisMessage(ctx, ownerID, message)
	if err != nil {
		return models.Message{}, err
	}
	s.invalidateChat(ctx, chatID, ownerID)
	return saved, nil
}

// GetChatHistory pages a chat's history newest-first. The first page comes
// from the cache; the cursor pages read the source.
func (s *ChatService) GetChatHistory(ctx context.Context, ownerID, chatID, cursor string, limit int) ([]models.Message, string, error) {
	if err := ValidateChatID(chatID); err != nil {
		return nil, "", err
	}
	limit = models.ClampHistoryLimit(limit)
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
