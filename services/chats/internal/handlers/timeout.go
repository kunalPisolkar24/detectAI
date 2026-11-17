package handlers

import (
	"context"
	"errors"
	"time"

	"connectrpc.com/connect"
)

// NewTimeoutInterceptor bounds every RPC. Without it a stalled source holds a
// caller for the life of the connection and requests pile up during an outage.
func NewTimeoutInterceptor(timeout time.Duration) connect.UnaryInterceptorFunc {
	return func(next connect.UnaryFunc) connect.UnaryFunc {
		return func(ctx context.Context, req connect.AnyRequest) (connect.AnyResponse, error) {
			ctx, cancel := context.WithTimeout(ctx, timeout)
			defer cancel()
			resp, err := next(ctx, req)
			if errors.Is(err, context.DeadlineExceeded) {
				return nil, connect.NewError(connect.CodeDeadlineExceeded, errors.New("request deadline exceeded"))
			}
			return resp, err
		}
	}
}
