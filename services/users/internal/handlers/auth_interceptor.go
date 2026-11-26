package handlers

import (
	"context"
	"errors"
	"strings"

	connectrpc "connectrpc.com/connect"
	"github.com/google/uuid"

	"github.com/kunalPisolkar24/detectAI/services/users/internal/models"
	"github.com/kunalPisolkar24/detectAI/services/users/internal/token"
	usersv1connect "github.com/kunalPisolkar24/detectAI/services/users/proto/usersv1connect"
)

type UserLookup interface {
	GetUserByID(ctx context.Context, id uuid.UUID) (models.User, error)
}

type userIDContextKey struct{}

func UserIDFrom(ctx context.Context) (uuid.UUID, bool) {
	userID, ok := ctx.Value(userIDContextKey{}).(uuid.UUID)
	return userID, ok
}

var authenticatedProcedures = map[string]bool{
	usersv1connect.UserServiceGetMeProcedure:     true,
	usersv1connect.UserServiceLogoutProcedure:    true,
	usersv1connect.UserServiceLogoutAllProcedure: true,
}

func NewAuthInterceptor(verifier token.AccessVerifier, lookup UserLookup) connectrpc.UnaryInterceptorFunc {
	return func(next connectrpc.UnaryFunc) connectrpc.UnaryFunc {
		return func(ctx context.Context, req connectrpc.AnyRequest) (connectrpc.AnyResponse, error) {
			if !authenticatedProcedures[req.Spec().Procedure] {
				return next(ctx, req)
			}
			raw := bearer(req.Header().Get("Authorization"))
			if raw == "" || verifier == nil || lookup == nil {
				return nil, unauthenticated()
			}
			claims, err := verifier.Verify(raw)
			if err != nil {
				return nil, connectError(err)
			}
			user, err := lookup.GetUserByID(ctx, claims.UserID)
			if err != nil {
				if errors.Is(err, models.ErrNotFound) {
					return nil, unauthenticated()
				}
				return nil, connectError(err)
			}
			if user.TokenVersion != claims.Version {
				return nil, unauthenticated()
			}
			return next(context.WithValue(ctx, userIDContextKey{}, claims.UserID), req)
		}
	}
}

func bearer(value string) string {
	parts := strings.Fields(value)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
		return ""
	}
	return parts[1]
}
