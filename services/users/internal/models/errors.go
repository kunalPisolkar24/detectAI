package models

import "errors"

var (
	// ErrInvalidToken covers expired, revoked, superseded and version-mismatched
	// tokens with one answer, so a caller cannot probe which check failed.
	ErrInvalidToken = errors.New("models: invalid token")
	ErrUnavailable  = errors.New("models: source unavailable")
)
