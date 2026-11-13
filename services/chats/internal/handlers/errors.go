package handlers

import (
	"errors"

	"connectrpc.com/connect"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/models"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/services"
)

func toConnectError(err error) error {
	switch {
	case errors.Is(err, models.ErrNotFound):
		return connect.NewError(connect.CodeNotFound, errors.New("chat not found"))
	case errors.Is(err, models.ErrInvalidCursor):
		return connect.NewError(connect.CodeInvalidArgument, errors.New("invalid cursor"))
	case errors.Is(err, models.ErrConflict):
		return connect.NewError(connect.CodeFailedPrecondition, errors.New("analysis state conflict"))
	case errors.Is(err, models.ErrUnavailable):
		return connect.NewError(connect.CodeUnavailable, errors.New("source unavailable"))
	default:
		var validation *services.ValidationError
		if errors.As(err, &validation) {
			return connect.NewError(connect.CodeInvalidArgument, errors.New(validation.Field+" "+validation.Reason))
		}
		return connect.NewError(connect.CodeInternal, errors.New("internal error"))
	}
}
