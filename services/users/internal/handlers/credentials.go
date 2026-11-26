package handlers

import (
	"errors"
	"net/http"

	"connectrpc.com/connect"
)

const refreshTokenHeader = "X-Refresh-Token"

func refreshToken(header http.Header) (string, error) {
	raw := header.Get(refreshTokenHeader)
	if raw == "" {
		return "", connect.NewError(connect.CodeUnauthenticated, errors.New("refresh token required"))
	}
	return raw, nil
}
