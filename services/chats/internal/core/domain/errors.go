package domain

import "errors"

var (
	ErrUnauthorized = errors.New("unauthorized: user does not own this resource")
	ErrNotFound     = errors.New("resource not found")
	ErrInvalidInput = errors.New("invalid input parameter")
)
