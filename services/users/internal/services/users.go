package services

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/google/uuid"

	"github.com/kunalPisolkar24/detectAI/services/users/internal/models"
	"github.com/kunalPisolkar24/detectAI/services/users/internal/repository"
	"github.com/kunalPisolkar24/detectAI/services/users/internal/token"
)

type UserCacheInvalidator interface {
	Invalidate(ctx context.Context, id uuid.UUID) error
}

type UserService struct {
	users         repository.UserRepository
	refresh       repository.RefreshTokenRepository
	refreshTokens *token.RefreshTokens
	cache         UserCacheInvalidator
}

func (s *UserService) GetMe(ctx context.Context, id uuid.UUID) (models.User, error) {
	return s.users.GetUserByID(ctx, id)
}

func (s *UserService) Logout(ctx context.Context, userID uuid.UUID, raw string) error {
	hash, err := s.refreshTokens.Hash(raw)
	if err != nil {
		return fmt.Errorf("services: logout: %w", models.ErrInvalidToken)
	}
	return s.refresh.RevokeRefreshToken(ctx, hash, userID)
}

func (s *UserService) LogoutAll(ctx context.Context, userID uuid.UUID) error {
	if err := s.refresh.RevokeAllRefreshTokensForUser(ctx, userID); err != nil {
		return err
	}
	if err := s.cache.Invalidate(ctx, userID); err != nil {
		slog.Warn("services: logout cache invalidation failed", "user", userID, "error", err)
	}
	return nil
}
