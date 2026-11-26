package services

import (
	"context"
	"log/slog"
	"time"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/cache/lock"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/models"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/observability"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/repository"
)

type Service interface {
	CreateChat(ctx context.Context, ownerID, initialMessage string) (models.Chat, error)
	GetChat(ctx context.Context, ownerID, chatID string) (models.Chat, []models.Message, string, error)
	ListChats(ctx context.Context, ownerID string, limit int) ([]models.ChatSummary, error)
	RenameChat(ctx context.Context, ownerID, chatID, title string) (models.ChatSummary, error)
	DeleteChat(ctx context.Context, ownerID, chatID string) error
	SaveUserMessage(ctx context.Context, ownerID, chatID, messageID, content string, createdAt time.Time) (models.Message, error)
	SaveAnalysisMessage(ctx context.Context, ownerID, chatID, messageID string, createdAt time.Time, analysis *models.Analysis) (models.Message, error)
	GetChatHistory(ctx context.Context, ownerID, chatID, cursor string, limit int) ([]models.Message, string, error)
}

// Cache is the consumer-owned view of the cache plane. The concrete entries
// satisfy it structurally, so a coalescing or locking decorator can replace
// them without changing this package or its callers.
type Cache interface {
	Chat(ctx context.Context, chatID string) (models.Chat, bool, error)
	PutChat(ctx context.Context, chat models.Chat) error
	ChatList(ctx context.Context, ownerID string) ([]models.ChatSummary, bool, error)
	PutChatList(ctx context.Context, ownerID string, chats []models.ChatSummary) error
	Head(ctx context.Context, chatID string) (models.Page, bool, error)
	PutHead(ctx context.Context, chatID string, page models.Page) error
	InvalidateMeta(ctx context.Context, chatID string) error
	InvalidateChat(ctx context.Context, chatID string) error
	InvalidateOwner(ctx context.Context, ownerID string) error
}

type Locker interface {
	Acquire(ctx context.Context, key string, ttl time.Duration) (string, error)
	Release(ctx context.Context, key, token string) error
}

type Coalescer interface {
	Do(ctx context.Context, key string, fn func(context.Context) (any, error)) (any, error)
}

type ChatService struct {
	repo      repository.Repository
	cache     Cache
	locker    Locker
	flights   Coalescer
	policy    lock.Policy
	logger    *slog.Logger
	telemetry observability.Telemetry
}

func NewChatService(
	repo repository.Repository,
	entries Cache,
	locker Locker,
	flights Coalescer,
	policy lock.Policy,
	logger *slog.Logger,
	telemetry observability.Telemetry,
) *ChatService {
	return &ChatService{
		repo: repo, cache: entries, locker: locker, flights: flights,
		policy: policy, logger: logger, telemetry: telemetry,
	}
}

var _ Service = (*ChatService)(nil)
