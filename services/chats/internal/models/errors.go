package models

import "errors"

// Sentinel errors the adapters return and the service maps to Connect codes.
var (
	// ErrNotFound answers a chat missing or not owned by the caller, and a
	// message id bound to a different chat — one error for "missing" and "not yours".
	ErrNotFound = errors.New("models: not found")
	// ErrInvalidCursor answers a malformed or foreign-chat history cursor —
	// never a fallback to the first page, or scrollback would loop forever.
	ErrInvalidCursor = errors.New("models: invalid cursor")
	// ErrConflict answers a write into a terminal analysis state that is not
	// an identical replay of what is stored.
	ErrConflict = errors.New("models: terminal analysis state conflict")
	// ErrUnavailable answers a source that cannot be reached; the transport
	// layer maps it to the wire's unavailable code.
	ErrUnavailable = errors.New("models: source unavailable")
)
