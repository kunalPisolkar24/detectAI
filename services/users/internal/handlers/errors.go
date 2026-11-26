package handlers

import (
	"errors"
	"log/slog"

	"connectrpc.com/connect"

	"github.com/kunalPisolkar24/detectAI/services/users/internal/models"
	"github.com/kunalPisolkar24/detectAI/services/users/internal/password"
	"github.com/kunalPisolkar24/detectAI/services/users/internal/services"
	"github.com/kunalPisolkar24/detectAI/services/users/internal/token"
)

func unauthenticated() error {
	return connect.NewError(connect.CodeUnauthenticated, errors.New("authentication failed"))
}

func connectError(err error) error {
	if err == nil {
		return nil
	}

	var code connect.Code
	var message string
	switch {
	case errors.Is(err, services.ErrInvalidCredentials),
		errors.Is(err, models.ErrInvalidToken),
		errors.Is(err, token.ErrInvalidToken),
		errors.Is(err, token.ErrInvalidRefreshToken):
		code, message = connect.CodeUnauthenticated, "authentication failed"
	case errors.Is(err, models.ErrEmailTaken), errors.Is(err, models.ErrConflict):
		code, message = connect.CodeAlreadyExists, "already exists"
	case errors.Is(err, models.ErrNotFound):
		code, message = connect.CodeNotFound, "not found"
	case errors.Is(err, models.ErrUnavailable):
		code, message = connect.CodeUnavailable, "service unavailable"
	case errors.Is(err, services.ErrInvalidInput), errors.Is(err, password.ErrTooLong):
		code, message = connect.CodeInvalidArgument, "invalid argument"
	default:
		slog.Warn("handler: unexpected service error", "error", err)
		code, message = connect.CodeInternal, "internal error"
	}
	return connect.NewError(code, errors.New(message))
}
