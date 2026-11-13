package connect

import (
	"context"
	"crypto/subtle"
	"errors"
	"strings"

	"connectrpc.com/connect"
)

const (
	apiKeyHeader = "x-api-key"
	userIDHeader = "x-user-id"
)

// ownerKey is the context key the resolved owner travels under.
type ownerKey struct{}

// OwnerFrom reads the owner the request speaks for.
func OwnerFrom(ctx context.Context) (string, error) {
	ownerID, ok := ctx.Value(ownerKey{}).(string)
	if !ok || ownerID == "" {
		return "", connect.NewError(connect.CodeUnauthenticated, errors.New("missing user id"))
	}
	return ownerID, nil
}

// NewAuthInterceptor authenticates the caller with the api key and resolves
// the owner the request speaks for.
func NewAuthInterceptor(apiKey string) connect.UnaryInterceptorFunc {
	return func(next connect.UnaryFunc) connect.UnaryFunc {
		return func(ctx context.Context, req connect.AnyRequest) (connect.AnyResponse, error) {
			if !credentialMatches(apiKey, req.Header().Get(apiKeyHeader)) {
				return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("invalid or missing API key"))
			}
			ownerID := strings.TrimSpace(req.Header().Get(userIDHeader))
			if ownerID == "" {
				return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("missing user id"))
			}
			return next(context.WithValue(ctx, ownerKey{}, ownerID), req)
		}
	}
}

// credentialMatches compares the presented key in constant time; a missing key
// is a mismatch.
func credentialMatches(expected, candidate string) bool {
	if candidate == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(expected), []byte(candidate)) == 1
}
