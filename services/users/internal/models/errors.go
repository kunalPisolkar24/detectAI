package models

import "errors"

var (
	// ErrInvalidToken covers expired, revoked, superseded and version-mismatched
	// tokens with one answer, so a caller cannot probe which check failed.
	ErrInvalidToken = errors.New("models: invalid token")
	ErrUnavailable  = errors.New("models: source unavailable")
	ErrNotFound     = errors.New("models: not found")
	ErrEmailTaken   = errors.New("models: email already registered")
	ErrConflict     = errors.New("models: identity already linked")
)
