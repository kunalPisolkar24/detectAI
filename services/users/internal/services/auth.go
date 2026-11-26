package services

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/kunalPisolkar24/detectAI/services/users/internal/models"
	"github.com/kunalPisolkar24/detectAI/services/users/internal/password"
	"github.com/kunalPisolkar24/detectAI/services/users/internal/repository"
	"github.com/kunalPisolkar24/detectAI/services/users/internal/token"
)

var (
	ErrInvalidCredentials = errors.New("services: invalid credentials")
	ErrInvalidInput       = errors.New("services: invalid input")
)

type AuthTokens struct {
	AccessToken  string
	RefreshToken string
	ExpiresIn    time.Duration
	User         models.User
}

type AuthService struct {
	users         repository.UserRepository
	refresh       repository.RefreshTokenRepository
	hasher        password.Hasher
	access        token.AccessIssuer
	refreshTokens *token.RefreshTokens
	accessTTL     time.Duration
}

func (s *AuthService) Register(ctx context.Context, email, rawPassword, firstName, lastName string) (models.User, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	if email == "" || rawPassword == "" || len(rawPassword) > password.MaxPasswordBytes {
		return models.User{}, ErrInvalidInput
	}

	hash, err := s.hasher.Hash(rawPassword)
	if err != nil {
		return models.User{}, fmt.Errorf("services: hash password: %w", err)
	}

	user := models.User{
		ID:           uuid.New(),
		Email:        email,
		FirstName:    sql.NullString{String: firstName, Valid: firstName != ""},
		LastName:     sql.NullString{String: lastName, Valid: lastName != ""},
		PasswordHash: sql.NullString{String: hash, Valid: true},
	}
	if err := s.users.CreateUser(ctx, user); err != nil {
		return models.User{}, err
	}

	user.PasswordHash = sql.NullString{}
	return user, nil
}

func (s *AuthService) Login(ctx context.Context, email, rawPassword string) (AuthTokens, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	if email == "" || rawPassword == "" || len(rawPassword) > password.MaxPasswordBytes {
		return AuthTokens{}, ErrInvalidCredentials
	}

	credentials, err := s.users.GetCredentialsByEmail(ctx, email)
	if err != nil {
		if errors.Is(err, models.ErrNotFound) {
			return AuthTokens{}, ErrInvalidCredentials
		}
		return AuthTokens{}, err
	}
	if credentials.PasswordHash == "" {
		return AuthTokens{}, ErrInvalidCredentials
	}

	matches, err := s.hasher.Verify(credentials.PasswordHash, rawPassword)
	if err != nil {
		return AuthTokens{}, fmt.Errorf("services: verify password: %w", err)
	}
	if !matches {
		return AuthTokens{}, ErrInvalidCredentials
	}

	user, err := s.users.GetUserByID(ctx, credentials.UserID)
	if err != nil {
		return AuthTokens{}, err
	}
	return s.issue(ctx, user)
}

func (s *AuthService) Refresh(ctx context.Context, raw string) (AuthTokens, error) {
	hash, err := s.refreshTokens.Hash(raw)
	if err != nil {
		return AuthTokens{}, fmt.Errorf("services: refresh: %w", models.ErrInvalidToken)
	}

	lookup, err := s.refresh.GetRefreshToken(ctx, hash)
	if err != nil {
		return AuthTokens{}, err
	}
	if !lookup.Token.ExpiresAt.After(time.Now()) || lookup.Token.RevokedAt.Valid {
		return AuthTokens{}, fmt.Errorf("services: refresh: %w", models.ErrInvalidToken)
	}

	user, err := s.users.GetUserByID(ctx, lookup.Token.UserID)
	if err != nil {
		return AuthTokens{}, err
	}

	access, _, err := s.access.Issue(user.ID, lookup.TokenVersion)
	if err != nil {
		return AuthTokens{}, fmt.Errorf("services: issue access token: %w", err)
	}
	rotated, err := s.refreshTokens.New()
	if err != nil {
		return AuthTokens{}, fmt.Errorf("services: issue refresh token: %w", err)
	}
	if err := s.refresh.RotateRefreshToken(
		ctx, hash, rotated.Hash, uuid.New(), lookup.TokenVersion, rotated.ExpiresAt,
	); err != nil {
		return AuthTokens{}, err
	}

	return AuthTokens{
		AccessToken:  access,
		RefreshToken: rotated.Value,
		ExpiresIn:    s.accessTTL,
		User:         user,
	}, nil
}

func (s *AuthService) issue(ctx context.Context, user models.User) (AuthTokens, error) {
	access, _, err := s.access.Issue(user.ID, user.TokenVersion)
	if err != nil {
		return AuthTokens{}, fmt.Errorf("services: issue access token: %w", err)
	}
	refresh, err := s.refreshTokens.New()
	if err != nil {
		return AuthTokens{}, fmt.Errorf("services: issue refresh token: %w", err)
	}
	if err := s.refresh.CreateRefreshToken(ctx, models.RefreshToken{
		ID:        uuid.New(),
		UserID:    user.ID,
		TokenHash: refresh.Hash,
		ExpiresAt: refresh.ExpiresAt,
	}); err != nil {
		return AuthTokens{}, fmt.Errorf("services: store refresh token: %w", err)
	}

	return AuthTokens{
		AccessToken:  access,
		RefreshToken: refresh.Value,
		ExpiresIn:    s.accessTTL,
		User:         user,
	}, nil
}
