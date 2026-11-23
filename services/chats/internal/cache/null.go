package cache

import (
	"context"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/models"
)

type NullCache struct{}

var _ Cache = NullCache{}

func (NullCache) Chat(context.Context, string) (models.Chat, bool, error) {
	return models.Chat{}, false, nil
}

func (NullCache) PutChat(context.Context, models.Chat) error { return nil }

func (NullCache) ChatList(context.Context, string) ([]models.ChatSummary, bool, error) {
	return nil, false, nil
}

func (NullCache) PutChatList(context.Context, string, []models.ChatSummary) error {
	return nil
}

func (NullCache) Head(context.Context, string) (models.Page, bool, error) {
	return models.Page{}, false, nil
}

func (NullCache) PutHead(context.Context, string, models.Page) error { return nil }

func (NullCache) InvalidateMeta(context.Context, string) error  { return nil }
func (NullCache) InvalidateChat(context.Context, string) error  { return nil }
func (NullCache) InvalidateOwner(context.Context, string) error { return nil }

type NullLimiter struct{}

var _ Limiter = NullLimiter{}

func (NullLimiter) Consume(_ context.Context, _ string, _ string, limit int) (Decision, error) {
	return Decision{Allowed: true, Limit: limit}, nil
}
