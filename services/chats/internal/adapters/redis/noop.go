package redis

import (
	"context"
	"errors"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/core/domain"
)

// ErrRedisUnavailable is returned by Noop implementations to signal degraded Redis.
var ErrRedisUnavailable = errors.New("redis unavailable: degraded mode")

// NoopCache satisfies ports.ChatCacheRepository but always reports degraded.
type NoopCache struct{}

func (n *NoopCache) SaveToCache(_ context.Context, _ *domain.Message) error { return ErrRedisUnavailable }
func (n *NoopCache) PopulateCache(_ context.Context, _ string, _ []*domain.Message) error {
	return ErrRedisUnavailable
}
func (n *NoopCache) GetRecentMessages(_ context.Context, _ string) ([]*domain.Message, error) {
	return nil, ErrRedisUnavailable
}
func (n *NoopCache) DeleteCache(_ context.Context, _ string) error { return ErrRedisUnavailable }

// NoopStream satisfies ports.ChatStreamRepository but always reports degraded.
type NoopStream struct{}

func (n *NoopStream) Publish(_ context.Context, _ *domain.Message) error { return ErrRedisUnavailable }

// IsRedisConnError reports definite Redis connectivity failures (definite = safe to sync-fallback).
func IsRedisConnError(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, ErrRedisUnavailable) {
		return true
	}
	msg := err.Error()
	for _, s := range []string{
		"connection refused",
		"connection reset",
		"broken pipe",
		"use of closed network connection",
		"EOF",
		"i/o timeout",
		"timeout",
		"no such host",
		"dial tcp",
		"client is closed",
	} {
		if containsFold(msg, s) {
			return true
		}
	}
	return false
}

func containsFold(s, substr string) bool {
	// case-insensitive contains without importing strings for a hot path
	ls := toLower(s)
	lsub := toLower(substr)
	return len(ls) >= len(lsub) && indexOf(ls, lsub) >= 0
}

func toLower(s string) string {
	b := []byte(s)
	for i, c := range b {
		if c >= 'A' && c <= 'Z' {
			b[i] = c + 32
		}
	}
	return string(b)
}

func indexOf(s, substr string) int {
	n := len(substr)
	if n == 0 {
		return 0
	}
	for i := 0; i <= len(s)-n; i++ {
		if s[i:i+n] == substr {
			return i
		}
	}
	return -1
}
