package repository

import (
	"context"
	"database/sql"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/kunalPisolkar24/detectAI/services/users/internal/db/sqlc"
	"github.com/kunalPisolkar24/detectAI/services/users/internal/models"
)

type UserRepository interface {
	CreateUser(ctx context.Context, user models.User) error
	GetUserByID(ctx context.Context, id uuid.UUID) (models.User, error)
	GetUserByEmail(ctx context.Context, email string) (models.User, error)
	GetCredentialsByEmail(ctx context.Context, email string) (models.Credentials, error)
	UpdateUserProfile(ctx context.Context, id uuid.UUID, name, firstName, lastName, image string) error
	SetEmailVerified(ctx context.Context, id uuid.UUID, verifiedAt time.Time) error
	DeleteUser(ctx context.Context, id uuid.UUID) error
}

func (r *Postgres) CreateUser(ctx context.Context, user models.User) error {
	err := r.queries.CreateUser(ctx, sqlc.CreateUserParams{
		ID:           user.ID,
		Email:        user.Email,
		PasswordHash: text(user.PasswordHash),
		FirstName:    text(user.FirstName),
		LastName:     text(user.LastName),
		Name:         text(user.Name),
		Image:        text(user.Image),
	})
	return wrap("create user", err, nil, models.ErrEmailTaken)
}

func (r *Postgres) GetUserByID(ctx context.Context, id uuid.UUID) (models.User, error) {
	row, err := r.queries.GetUserByID(ctx, id)
	if err != nil {
		return models.User{}, wrap("get user by id", err, models.ErrNotFound, nil)
	}
	return userFrom(
		row.ID, row.Email, row.Name, row.FirstName, row.LastName, row.Image,
		row.EmailVerifiedAt, row.TokenVersion, row.CreatedAt, row.UpdatedAt,
	), nil
}

func (r *Postgres) GetUserByEmail(ctx context.Context, email string) (models.User, error) {
	row, err := r.queries.GetUserByEmail(ctx, email)
	if err != nil {
		return models.User{}, wrap("get user by email", err, models.ErrNotFound, nil)
	}
	return userFrom(
		row.ID, row.Email, row.Name, row.FirstName, row.LastName, row.Image,
		row.EmailVerifiedAt, row.TokenVersion, row.CreatedAt, row.UpdatedAt,
	), nil
}

func (r *Postgres) GetCredentialsByEmail(ctx context.Context, email string) (models.Credentials, error) {
	row, err := r.queries.GetCredentialsByEmail(ctx, email)
	if err != nil {
		return models.Credentials{}, wrap("get credentials by email", err, models.ErrNotFound, nil)
	}
	return models.Credentials{
		UserID:       row.ID,
		PasswordHash: row.PasswordHash,
		TokenVersion: int(row.TokenVersion),
	}, nil
}

func (r *Postgres) UpdateUserProfile(ctx context.Context, id uuid.UUID, name, firstName, lastName, image string) error {
	err := r.queries.UpdateUserProfile(ctx, sqlc.UpdateUserProfileParams{
		ID:        id,
		Name:      name,
		FirstName: firstName,
		LastName:  lastName,
		Image:     image,
	})
	return wrap("update user profile", err, nil, nil)
}

func (r *Postgres) SetEmailVerified(ctx context.Context, id uuid.UUID, verifiedAt time.Time) error {
	err := r.queries.SetEmailVerified(ctx, sqlc.SetEmailVerifiedParams{
		ID:         id,
		VerifiedAt: timestamp(verifiedAt),
	})
	return wrap("set email verified", err, nil, nil)
}

func (r *Postgres) DeleteUser(ctx context.Context, id uuid.UUID) error {
	return wrap("delete user", r.queries.DeleteUser(ctx, id), nil, nil)
}

func userFrom(
	id uuid.UUID,
	email, name, firstName, lastName, image string,
	verifiedAt pgtype.Timestamptz,
	tokenVersion int32,
	createdAt, updatedAt pgtype.Timestamptz,
) models.User {
	return models.User{
		ID:              id,
		Email:           email,
		Name:            nullString(name),
		FirstName:       nullString(firstName),
		LastName:        nullString(lastName),
		Image:           nullString(image),
		EmailVerifiedAt: nullTime(verifiedAt),
		PasswordHash:    sql.NullString{},
		TokenVersion:    int(tokenVersion),
		CreatedAt:       createdAt.Time,
		UpdatedAt:       updatedAt.Time,
	}
}
