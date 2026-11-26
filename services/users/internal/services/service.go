package services

import (
	"time"

	"github.com/kunalPisolkar24/detectAI/services/users/internal/cache/coalescer"
	"github.com/kunalPisolkar24/detectAI/services/users/internal/cache/lock"
	"github.com/kunalPisolkar24/detectAI/services/users/internal/cache/store"
	"github.com/kunalPisolkar24/detectAI/services/users/internal/password"
	"github.com/kunalPisolkar24/detectAI/services/users/internal/repository"
	"github.com/kunalPisolkar24/detectAI/services/users/internal/token"
)

func NewCachedUsers(
	repo repository.UserRepository,
	store store.Store,
	locker lock.Locker,
	policy lock.Policy,
	queryTimeout time.Duration,
	flights coalescer.Coalescer,
) *CachedUsers {
	return &CachedUsers{
		repo:         repo,
		store:        store,
		locker:       locker,
		policy:       policy,
		queryTimeout: queryTimeout,
		flights:      flights,
	}
}

func NewAuthService(
	users repository.UserRepository,
	refresh repository.RefreshTokenRepository,
	hasher password.Hasher,
	access token.AccessIssuer,
	refreshTokens *token.RefreshTokens,
	accessTTL time.Duration,
) *AuthService {
	return &AuthService{
		users:         users,
		refresh:       refresh,
		hasher:        hasher,
		access:        access,
		refreshTokens: refreshTokens,
		accessTTL:     accessTTL,
	}
}

func NewUserService(
	users repository.UserRepository,
	refresh repository.RefreshTokenRepository,
	refreshTokens *token.RefreshTokens,
	cache UserCacheInvalidator,
) *UserService {
	return &UserService{
		users:         users,
		refresh:       refresh,
		refreshTokens: refreshTokens,
		cache:         cache,
	}
}
