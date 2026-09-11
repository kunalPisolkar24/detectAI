package redis

import (
	"context"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/core/domain"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/core/ports"
)

var ErrRedisUnavailable = domain.ErrUnavailable

type NoopCache struct{}

func (n *NoopCache) SaveToCache(_ context.Context, _ *domain.Message) error {
	return domain.ErrUnavailable
}
func (n *NoopCache) PopulateCache(_ context.Context, _ string, _ []*domain.Message) error {
	return domain.ErrUnavailable
}
func (n *NoopCache) GetRecentMessages(_ context.Context, _ string) ([]*domain.Message, error) {
	return nil, domain.ErrUnavailable
}
func (n *NoopCache) DeleteCache(_ context.Context, _ string) error {
	return domain.ErrUnavailable
}

type NoopStream struct{}

func (n *NoopStream) Publish(_ context.Context, _ *domain.Message) error {
	return domain.ErrUnavailable
}

func IsRedisConnError(err error) bool {
	return ports.IsTransient(err)
}
