package services

import (
	"context"
	"time"
)

// CreateChat opens a chat and stores the message that opened it.
func (s *ChatService) CreateChat(ctx context.Context, ownerID, initialMessage string) (Chat, error) {
	if err := ValidateContent(initialMessage); err != nil {
		return Chat{}, err
	}
	title := DeriveChatTitle(initialMessage)
	if err := ValidateChatTitle(title); err != nil {
		return Chat{}, err
	}

	chat, err := s.repo.CreateChat(ctx, ownerID, title)
	if err != nil {
		return Chat{}, err
	}
	if _, err := s.repo.SaveUserMessage(ctx, ownerID, Message{
		ChatID:  chat.ID,
		Role:    RoleUser,
		Content: initialMessage,
	}); err != nil {
		return Chat{}, err
	}
	s.invalidateOwner(ctx, ownerID)
	return chat, nil
}

// GetChat returns the chat meta with its head page and the cursor that
// chains to the next one.
func (s *ChatService) GetChat(ctx context.Context, ownerID, chatID string) (Chat, []Message, string, error) {
	if err := ValidateChatID(chatID); err != nil {
		return Chat{}, nil, "", err
	}
	chat, err := s.cachedChat(ctx, ownerID, chatID)
	if err != nil {
		return Chat{}, nil, "", err
	}
	page, err := s.headPage(ctx, ownerID, chatID, DefaultHistoryLimit)
	if err != nil {
		return Chat{}, nil, "", err
	}
	return chat, page.Messages, page.NextCursor, nil
}

// ListChats returns the owner's chats newest-first.
func (s *ChatService) ListChats(ctx context.Context, ownerID string, limit int) ([]ChatSummary, error) {
	return s.cachedList(ctx, ownerID, ClampChatsLimit(limit))
}

// RenameChat sets a chat's title.
func (s *ChatService) RenameChat(ctx context.Context, ownerID, chatID, title string) (ChatSummary, error) {
	if err := ValidateChatID(chatID); err != nil {
		return ChatSummary{}, err
	}
	if err := ValidateChatTitle(title); err != nil {
		return ChatSummary{}, err
	}
	summary, err := s.repo.RenameChat(ctx, ownerID, chatID, title)
	if err != nil {
		return ChatSummary{}, err
	}
	s.invalidateMeta(ctx, chatID, ownerID)
	return summary, nil
}

// DeleteChat deletes a chat and its messages.
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

// SaveUserMessage stores a message the user sent.
func (s *ChatService) SaveUserMessage(ctx context.Context, ownerID, chatID, messageID, content string, createdAt time.Time) (Message, error) {
	message := Message{
		ID:        messageID,
		ChatID:    chatID,
		Role:      RoleUser,
		Content:   content,
		CreatedAt: createdAt,
	}
	if err := ValidateUserMessage(message); err != nil {
		return Message{}, err
	}
	saved, err := s.repo.SaveUserMessage(ctx, ownerID, message)
	if err != nil {
		return Message{}, err
	}
	s.invalidateChat(ctx, chatID, ownerID)
	return saved, nil
}

// SaveAnalysisMessage stores the analysis state of a message.
func (s *ChatService) SaveAnalysisMessage(ctx context.Context, ownerID, chatID, messageID string, createdAt time.Time, analysis *Analysis) (Message, error) {
	message := Message{
		ID:        messageID,
		ChatID:    chatID,
		Role:      RoleAssistant,
		CreatedAt: createdAt,
		Analysis:  analysis,
	}
	if err := ValidateAnalysisMessage(message); err != nil {
		return Message{}, err
	}
	saved, err := s.repo.SaveAnalysisMessage(ctx, ownerID, message)
	if err != nil {
		return Message{}, err
	}
	s.invalidateChat(ctx, chatID, ownerID)
	return saved, nil
}

// GetChatHistory pages a chat's history newest-first. The first page comes
// from the cache; the cursor pages read the source.
func (s *ChatService) GetChatHistory(ctx context.Context, ownerID, chatID, cursor string, limit int) ([]Message, string, error) {
	if err := ValidateChatID(chatID); err != nil {
		return nil, "", err
	}
	limit = ClampHistoryLimit(limit)
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
