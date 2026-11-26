package handlers

import (
	"errors"
	"net/http"
	"strings"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	"github.com/kunalPisolkar24/detectAI/services/users/internal/token"
)

type identity struct {
	verifier token.AccessVerifier
}

func newIdentity(verifier token.AccessVerifier) identity {
	return identity{verifier: verifier}
}

func (i identity) userID(header http.Header) (uuid.UUID, error) {
	raw := bearer(header.Get("Authorization"))
	if i.verifier == nil || raw == "" {
		return uuid.Nil, connect.NewError(connect.CodeUnauthenticated, errors.New("authentication required"))
	}
	claims, err := i.verifier.Verify(raw)
	if err != nil {
		return uuid.Nil, connectError(err)
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
