package services

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"

	"github.com/kunalPisolkar24/detectAI/services/users/internal/cache"
	"github.com/kunalPisolkar24/detectAI/services/users/internal/models"
	"github.com/kunalPisolkar24/detectAI/services/users/internal/repository"
)

const (
	envelopeVersion = 1
	missingMarker   = "1"
)

type envelope struct {
	Version int         `json:"v"`
	User    models.User `json:"user"`
}

type CachedUsers struct {
	repo         repository.UserRepository
	store        cache.Store
	locker       cache.Locker
	policy       cache.Policy
	queryTimeout time.Duration
}

var _ repository.UserRepository = (*CachedUsers)(nil)

func (s *CachedUsers) CreateUser(ctx context.Context, user models.User) error {
	userResource := cache.UserResource(user.ID.String())
	emailResource := cache.EmailResource(user.Email)

	return s.write(ctx, userResource, func(ctx context.Context) error {
		return s.write(ctx, emailResource, func(ctx context.Context) error {
			_, err := within(ctx, s.queryTimeout, func(ctx context.Context) (struct{}, error) {
				return struct{}{}, s.repo.CreateUser(ctx, user)
			})
			if err != nil {
				return err
			}
			s.invalidate(ctx, cache.MissKey(userResource), cache.MissKey(emailResource))
			return nil
		})
	})
}

func (s *CachedUsers) GetCredentialsByEmail(ctx context.Context, email string) (models.Credentials, error) {
	resource := cache.EmailResource(email)
	if s.missing(ctx, cache.MissKey(resource)) {
		return models.Credentials{}, models.ErrNotFound
	}

	credentials, err := within(ctx, s.queryTimeout, func(ctx context.Context) (models.Credentials, error) {
		return s.repo.GetCredentialsByEmail(ctx, email)
	})
	if err != nil && errors.Is(err, models.ErrNotFound) {
		s.markMissing(ctx, resource)
	}
	return credentials, err
}

func (s *CachedUsers) GetUserByID(ctx context.Context, id uuid.UUID) (models.User, error) {
	resource := cache.UserResource(id.String())
	return s.read(ctx, cache.DataKey(resource), resource, func(ctx context.Context) (models.User, error) {
		return s.repo.GetUserByID(ctx, id)
	})
}

func (s *CachedUsers) GetUserByEmail(ctx context.Context, email string) (models.User, error) {
	id, err := s.resolveIDByEmail(ctx, email)
	if err != nil {
		return models.User{}, err
	}
	userID, err := uuid.Parse(id)
	if err != nil {
		return models.User{}, fmt.Errorf("services: email pointer: %w", err)
	}
	return s.GetUserByID(ctx, userID)
}

func (s *CachedUsers) UpdateUserProfile(ctx context.Context, id uuid.UUID, name, firstName, lastName, image string) error {
	resource := cache.UserResource(id.String())
	return s.write(ctx, resource, func(ctx context.Context) error {
		_, err := within(ctx, s.queryTimeout, func(ctx context.Context) (struct{}, error) {
			return struct{}{}, s.repo.UpdateUserProfile(ctx, id, name, firstName, lastName, image)
		})
		if err != nil {
			return err
		}
		s.invalidate(ctx, cache.DataKey(resource))
		return nil
	})
}

func (s *CachedUsers) SetEmailVerified(ctx context.Context, id uuid.UUID, verifiedAt time.Time) error {
	resource := cache.UserResource(id.String())
	return s.write(ctx, resource, func(ctx context.Context) error {
		_, err := within(ctx, s.queryTimeout, func(ctx context.Context) (struct{}, error) {
			return struct{}{}, s.repo.SetEmailVerified(ctx, id, verifiedAt)
		})
		if err != nil {
			return err
		}
		s.invalidate(ctx, cache.DataKey(resource))
		return nil
	})
}

func (s *CachedUsers) DeleteUser(ctx context.Context, id uuid.UUID) error {
	resource := cache.UserResource(id.String())
	keys := []string{cache.DataKey(resource)}

	if email := s.emailFor(ctx, id); email != "" {
		keys = append(keys, cache.DataKey(cache.EmailResource(email)))
	}

	return s.write(ctx, resource, func(ctx context.Context) error {
		_, err := within(ctx, s.queryTimeout, func(ctx context.Context) (struct{}, error) {
			return struct{}{}, s.repo.DeleteUser(ctx, id)
		})
		if err != nil {
			return err
		}
		s.invalidate(ctx, keys...)
		return nil
	})
}

func (s *CachedUsers) Invalidate(ctx context.Context, id uuid.UUID) error {
	resource := cache.UserResource(id.String())
	return s.write(ctx, resource, func(ctx context.Context) error {
		s.invalidate(ctx, cache.DataKey(resource))
		return nil
	})
}

func (s *CachedUsers) read(
	ctx context.Context,
	key, resource string,
	fetch func(context.Context) (models.User, error),
) (models.User, error) {
	missKey := cache.MissKey(resource)
	if s.missing(ctx, missKey) {
		return models.User{}, models.ErrNotFound
	}
	if user, ok := s.cached(ctx, key); ok {
		return user, nil
	}

	return cache.Execute(ctx, s.locker, cache.LockKey(resource), s.policy, func(ctx context.Context) (models.User, error) {
		if s.missing(ctx, missKey) {
			return models.User{}, models.ErrNotFound
		}
		if user, ok := s.cached(ctx, key); ok {
			return user, nil
		}

		user, err := within(ctx, s.queryTimeout, fetch)
		if err != nil {
			if errors.Is(err, models.ErrNotFound) {
				s.markMissing(ctx, resource)
			}
			return models.User{}, err
		}
		s.put(ctx, key, newEnvelope(user), cache.UserTTL)
		return user, nil
	})
}

func (s *CachedUsers) resolveIDByEmail(ctx context.Context, email string) (string, error) {
	resource := cache.EmailResource(email)
	key := cache.DataKey(resource)
	missKey := cache.MissKey(resource)

	if s.missing(ctx, missKey) {
		return "", models.ErrNotFound
	}
	if id, ok := s.pointer(ctx, key); ok {
		return id, nil
	}

	return cache.Execute(ctx, s.locker, cache.LockKey(resource), s.policy, func(ctx context.Context) (string, error) {
		if s.missing(ctx, missKey) {
			return "", models.ErrNotFound
		}
		if id, ok := s.pointer(ctx, key); ok {
			return id, nil
		}

		user, err := within(ctx, s.queryTimeout, func(ctx context.Context) (models.User, error) {
			return s.repo.GetUserByEmail(ctx, email)
		})
		if err != nil {
			if errors.Is(err, models.ErrNotFound) {
				s.markMissing(ctx, resource)
			}
			return "", err
		}
		s.put(ctx, key, user.ID.String(), cache.EmailTTL)
		return user.ID.String(), nil
	})
}

func (s *CachedUsers) write(ctx context.Context, resource string, fn func(context.Context) error) error {
	_, err := cache.Execute(ctx, s.locker, cache.LockKey(resource), s.policy, func(ctx context.Context) (struct{}, error) {
		return struct{}{}, fn(ctx)
	})
	return err
}

func (s *CachedUsers) cached(ctx context.Context, key string) (models.User, bool) {
	var entry envelope
	found, err := s.store.Get(ctx, key, &entry)
	if err != nil {
		slog.Warn("cache: read failed", "key", key, "error", err)
		return models.User{}, false
	}
	if !found || entry.Version != envelopeVersion {
		return models.User{}, false
	}
	return entry.User, true
}

func (s *CachedUsers) pointer(ctx context.Context, key string) (string, bool) {
	var id string
	found, err := s.store.Get(ctx, key, &id)
	if err != nil {
		slog.Warn("cache: read failed", "key", key, "error", err)
		return "", false
	}
	return id, found && id != ""
}

func (s *CachedUsers) missing(ctx context.Context, key string) bool {
	var marker string
	found, err := s.store.Get(ctx, key, &marker)
	if err != nil {
		slog.Warn("cache: read failed", "key", key, "error", err)
		return false
	}
	return found && marker == missingMarker
}

func (s *CachedUsers) emailFor(ctx context.Context, id uuid.UUID) string {
	if user, ok := s.cachedByID(ctx, id.String()); ok {
		return user.Email
	}
	user, err := within(ctx, s.queryTimeout, func(ctx context.Context) (models.User, error) {
		return s.repo.GetUserByID(ctx, id)
	})
	if err != nil {
		return ""
	}
	return user.Email
}

func (s *CachedUsers) cachedByID(ctx context.Context, id string) (models.User, bool) {
	return s.cached(ctx, cache.DataKey(cache.UserResource(id)))
}

func (s *CachedUsers) markMissing(ctx context.Context, resource string) {
	s.put(ctx, cache.MissKey(resource), missingMarker, cache.NegativeTTL)
}

func (s *CachedUsers) put(ctx context.Context, key string, value any, ttl time.Duration) {
	if err := s.store.Set(ctx, key, value, ttl); err != nil {
		slog.Warn("cache: write failed", "key", key, "error", err)
	}
}

func (s *CachedUsers) invalidate(ctx context.Context, keys ...string) {
	if err := s.store.Delete(ctx, keys...); err != nil {
		slog.Warn("cache: invalidation failed", "keys", keys, "error", err)
	}
}

func newEnvelope(user models.User) envelope {
	return envelope{Version: envelopeVersion, User: user}
}

func within[T any](ctx context.Context, timeout time.Duration, fn func(context.Context) (T, error)) (T, error) {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	return fn(ctx)
}
