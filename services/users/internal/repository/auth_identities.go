package repository

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/kunalPisolkar24/detectAI/services/users/internal/db/sqlc"
	"github.com/kunalPisolkar24/detectAI/services/users/internal/models"
)

type AuthIdentityRepository interface {
	CreateAuthIdentity(ctx context.Context, identity models.Identity) error
	GetAuthIdentity(ctx context.Context, provider models.Provider, accountID string) (models.Identity, error)
	ListAuthIdentitiesForUser(ctx context.Context, userID uuid.UUID) ([]models.Identity, error)
	UpdateAuthIdentityEmail(ctx context.Context, id uuid.UUID, email string) error
	DeleteAuthIdentity(ctx context.Context, id uuid.UUID) error
}

func (r *Postgres) CreateAuthIdentity(ctx context.Context, identity models.Identity) error {
	err := r.queries.CreateAuthIdentity(ctx, sqlc.CreateAuthIdentityParams{
		ID:                identity.ID,
		UserID:            identity.UserID,
		Provider:          string(identity.Provider),
		ProviderAccountID: identity.ProviderAccountID,
		ProviderEmail:     text(identity.ProviderEmail),
	})
	return wrap("create auth identity", err, models.ErrNotFound, models.ErrConflict)
}

func (r *Postgres) GetAuthIdentity(ctx context.Context, provider models.Provider, accountID string) (models.Identity, error) {
	row, err := r.queries.GetAuthIdentity(ctx, sqlc.GetAuthIdentityParams{
		Provider:          string(provider),
		ProviderAccountID: accountID,
	})
	if err != nil {
		return models.Identity{}, wrap("get auth identity", err, models.ErrNotFound, nil)
	}
	return identityFrom(
		row.ID, row.UserID, row.Provider, row.ProviderAccountID, row.ProviderEmail,
		row.CreatedAt, row.UpdatedAt,
	), nil
}

func (r *Postgres) ListAuthIdentitiesForUser(ctx context.Context, userID uuid.UUID) ([]models.Identity, error) {
	rows, err := r.queries.ListAuthIdentitiesForUser(ctx, userID)
	if err != nil {
		return nil, wrap("list auth identities for user", err, models.ErrNotFound, nil)
	}
	identities := make([]models.Identity, 0, len(rows))
	for _, row := range rows {
		identities = append(identities, identityFrom(
			row.ID, row.UserID, row.Provider, row.ProviderAccountID, row.ProviderEmail,
			row.CreatedAt, row.UpdatedAt,
		))
	}
	return identities, nil
}

func (r *Postgres) UpdateAuthIdentityEmail(ctx context.Context, id uuid.UUID, email string) error {
	err := r.queries.UpdateAuthIdentityEmail(ctx, sqlc.UpdateAuthIdentityEmailParams{
		ID:            id,
		ProviderEmail: email,
	})
	return wrap("update auth identity email", err, nil, nil)
}

func (r *Postgres) DeleteAuthIdentity(ctx context.Context, id uuid.UUID) error {
	return wrap("delete auth identity", r.queries.DeleteAuthIdentity(ctx, id), nil, nil)
}

func identityFrom(
	id, userID uuid.UUID,
	provider, accountID, email string,
	createdAt, updatedAt pgtype.Timestamptz,
) models.Identity {
	return models.Identity{
		ID:                id,
		UserID:            userID,
		Provider:          models.Provider(provider),
		ProviderAccountID: accountID,
		ProviderEmail:     nullString(email),
		CreatedAt:         createdAt.Time,
		UpdatedAt:         updatedAt.Time,
	}
}
