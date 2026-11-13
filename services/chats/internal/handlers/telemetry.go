package handlers

import (
	"context"
	"time"

	"connectrpc.com/connect"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/observability"
)

// NewTelemetryInterceptor opens the procedure's span and records the answer. It
// runs outermost in the chain, so the refusals of the inner interceptors — the
// rate limit and the credential check — are counted too.
func NewTelemetryInterceptor(obs observability.Telemetry) connect.UnaryInterceptorFunc {
	return func(next connect.UnaryFunc) connect.UnaryFunc {
		return func(ctx context.Context, req connect.AnyRequest) (connect.AnyResponse, error) {
			procedure := req.Spec().Procedure
			ctx, end := obs.TrackRPC(ctx, procedure)
			start := time.Now()
			status := observability.RPCStatusOK
			// The verdict is settled on the way out, so a panic still closes the
			// span and counts the call; the panic itself is re-raised for the
			// server's recovery to handle.
			defer func() {
				if recovered := recover(); recovered != nil {
					obs.RecordRPC(procedure, observability.RPCStatusInternal, time.Since(start))
					end(observability.RPCStatusInternal)
					panic(recovered)
				}
				obs.RecordRPC(procedure, status, time.Since(start))
				end(status)
			}()
			response, err := next(ctx, req)
			if err != nil {
				status = observability.RPCStatus(connect.CodeOf(err).String())
			}
			return response, err
		}
	}
}
