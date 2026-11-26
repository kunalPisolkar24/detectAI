package services

import (
	"context"
	"fmt"

	"github.com/google/uuid"

	"github.com/kunalPisolkar24/detectAI/services/users/internal/models"
	"github.com/kunalPisolkar24/detectAI/services/users/internal/repository"
	"github.com/kunalPisolkar24/detectAI/services/users/internal/token"
)

type UserService struct {
	users         repository.UserRepository
	refresh       repository.RefreshTokenRepository
	refreshTokens *token.RefreshTokens
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
	return s.refresh.RevokeAllRefreshTokensForUser(ctx, userID)
}
