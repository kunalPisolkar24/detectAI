package repository

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/kunalPisolkar24/detectAI/services/users/internal/db/sqlc"
	"github.com/kunalPisolkar24/detectAI/services/users/internal/models"
)

type RefreshTokenRepository interface {
	CreateRefreshToken(ctx context.Context, token models.RefreshToken) error
	GetRefreshToken(ctx context.Context, id uuid.UUID) (models.RefreshTokenLookup, error)
	RevokeRefreshToken(ctx context.Context, id, userID uuid.UUID) error
	RotateRefreshToken(ctx context.Context, oldID, newID uuid.UUID, expectedVersion int, expiresAt time.Time) error
	RevokeAllRefreshTokensForUser(ctx context.Context, userID uuid.UUID) error
	DeleteExpiredRefreshTokens(ctx context.Context, userID uuid.UUID) error
}

func (r *Postgres) CreateRefreshToken(ctx context.Context, token models.RefreshToken) error {
	err := r.queries.CreateRefreshToken(ctx, sqlc.CreateRefreshTokenParams{
		ID:        token.ID,
		UserID:    token.UserID,
		ExpiresAt: timestamp(token.ExpiresAt),
	})
	return wrap("create refresh token", err, models.ErrNotFound, nil)
}

func (r *Postgres) GetRefreshToken(ctx context.Context, id uuid.UUID) (models.RefreshTokenLookup, error) {
	row, err := r.queries.GetRefreshToken(ctx, id)
	if err != nil {
		return models.RefreshTokenLookup{}, wrap("get refresh token", err, models.ErrInvalidToken, nil)
	}
	return models.RefreshTokenLookup{
		Token: models.RefreshToken{
			ID:        row.ID,
			UserID:    row.UserID,
			ExpiresAt: row.ExpiresAt.Time,
			RevokedAt: nullTime(row.RevokedAt),
			CreatedAt: row.CreatedAt.Time,
			UpdatedAt: row.UpdatedAt.Time,
		},
		TokenVersion: int(row.TokenVersion),
	}, nil
}

func (r *Postgres) RevokeRefreshToken(ctx context.Context, id, userID uuid.UUID) error {
	err := r.queries.RevokeRefreshToken(ctx, sqlc.RevokeRefreshTokenParams{ID: id, UserID: userID})
	return wrap("revoke refresh token", err, nil, nil)
}

func (r *Postgres) RotateRefreshToken(ctx context.Context, oldID, newID uuid.UUID, expectedVersion int, expiresAt time.Time) error {
	rotated, err := r.queries.RotateRefreshToken(ctx, sqlc.RotateRefreshTokenParams{
		OldID:           oldID,
		NewID:           newID,
		ExpectedVersion: int32(expectedVersion),
		NewExpiresAt:    timestamp(expiresAt),
	})
	if err != nil {
		return wrap("rotate refresh token", err, models.ErrInvalidToken, nil)
	}
	if !rotated {
		return fmt.Errorf("repository: rotate refresh token: %w", models.ErrInvalidToken)
	}
	return nil
}

func (r *Postgres) RevokeAllRefreshTokensForUser(ctx context.Context, userID uuid.UUID) error {
	err := r.queries.RevokeAllRefreshTokensForUser(ctx, userID)
	return wrap("revoke all refresh tokens for user", err, models.ErrNotFound, nil)
}

func (r *Postgres) DeleteExpiredRefreshTokens(ctx context.Context, userID uuid.UUID) error {
	err := r.queries.DeleteExpiredRefreshTokens(ctx, userID)
	return wrap("delete expired refresh tokens", err, nil, nil)
}
