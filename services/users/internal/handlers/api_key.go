package handlers

import (
	"context"
	"crypto/subtle"
	"errors"

	"connectrpc.com/connect"
)

const apiKeyHeader = "x-api-key"

// NewAPIKeyInterceptor authenticates the caller before any user token,
// datastore, or limiter work happens.
func NewAPIKeyInterceptor(apiKey string) connect.UnaryInterceptorFunc {
	return func(next connect.UnaryFunc) connect.UnaryFunc {
		return func(ctx context.Context, req connect.AnyRequest) (connect.AnyResponse, error) {
			if !credentialMatches(apiKey, req.Header().Get(apiKeyHeader)) {
				return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("invalid or missing API key"))
			}
			return next(ctx, req)
		}
	}
}

// Compares the presented key in constant time; a missing key is a mismatch.
func credentialMatches(expected, candidate string) bool {
	if candidate == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(expected), []byte(candidate)) == 1
}
