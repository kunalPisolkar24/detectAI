package entries

import (
	"context"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/models"
)

type Null struct{}

var _ Cache = Null{}

func (Null) Chat(context.Context, string) (models.Chat, bool, error) {
	return models.Chat{}, false, nil
}

func (Null) PutChat(context.Context, models.Chat) error { return nil }

func (Null) ChatList(context.Context, string) ([]models.ChatSummary, bool, error) {
	return nil, false, nil
}

func (Null) PutChatList(context.Context, string, []models.ChatSummary) error {
	return nil
}

func (Null) Head(context.Context, string) (models.Page, bool, error) {
	return models.Page{}, false, nil
}

func (Null) PutHead(context.Context, string, models.Page) error { return nil }

func (Null) InvalidateMeta(context.Context, string) error  { return nil }
func (Null) InvalidateChat(context.Context, string) error  { return nil }
func (Null) InvalidateOwner(context.Context, string) error { return nil }
