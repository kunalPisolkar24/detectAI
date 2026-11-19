package observability

import (
	"context"
	"time"
)

// NullTelemetry is the disabled boot for an unset OTEL_EXPORTER_OTLP_ENDPOINT.
type NullTelemetry struct{}

var _ Telemetry = NullTelemetry{}

func (NullTelemetry) TrackRPC(ctx context.Context, _ string) (context.Context, func(RPCStatus)) {
	return ctx, func(RPCStatus) {}
}

func (NullTelemetry) RecordRPC(string, RPCStatus, time.Duration)               {}
func (NullTelemetry) RecordCacheOp(string, CacheResult, time.Duration)         {}
func (NullTelemetry) RecordDatastoreOp(string, DatastoreResult, time.Duration) {}
func (NullTelemetry) RecordRateLimitRefusal(string)                            {}
func (NullTelemetry) RecordValidationRejection(string)                         {}

func (NullTelemetry) Shutdown(context.Context) error { return nil }
