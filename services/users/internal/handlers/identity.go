package handlers

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/google/uuid"

	"github.com/kunalPisolkar24/detectAI/services/users/internal/models"
	"github.com/kunalPisolkar24/detectAI/services/users/internal/token"
)

type UserLookup interface {
	GetUserByID(ctx context.Context, id uuid.UUID) (models.User, error)
}

type identity struct {
	verifier token.AccessVerifier
	lookup   UserLookup
}

func newIdentity(verifier token.AccessVerifier, lookup UserLookup) identity {
	return identity{verifier: verifier, lookup: lookup}
}

func (i identity) userID(ctx context.Context, header http.Header) (uuid.UUID, error) {
	raw := bearer(header.Get("Authorization"))
	if i.verifier == nil || i.lookup == nil || raw == "" {
		return uuid.Nil, unauthenticated()
	}

	claims, err := i.verifier.Verify(raw)
	if err != nil {
		return uuid.Nil, connectError(err)
	}

	user, err := i.lookup.GetUserByID(ctx, claims.UserID)
	if err != nil {
		if errors.Is(err, models.ErrNotFound) {
			return uuid.Nil, unauthenticated()
		}
		return uuid.Nil, connectError(err)
	}
	if user.TokenVersion != claims.Version {
		return uuid.Nil, unauthenticated()
	}
	return claims.UserID, nil
}

func bearer(value string) string {
	parts := strings.Fields(value)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
		return ""
	}
	return parts[1]
}
