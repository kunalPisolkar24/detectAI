package observability

import (
	"context"
	"time"
)

// NullTelemetry is the disabled boot, built when OTEL_EXPORTER_OTLP_ENDPOINT is
// unset: one code path with no endpoint branches, zero SDK objects behind it.
type NullTelemetry struct{}

var _ Telemetry = NullTelemetry{}

func (NullTelemetry) TrackProcessing(ctx context.Context, _, _ string) (context.Context, func()) {
	return ctx, func() {}
}

func (NullTelemetry) RecordBodyError(Reason)                             {}
func (NullTelemetry) RecordInvalidSignature()                            {}
func (NullTelemetry) RecordEnvelopeRejection(string)                     {}
func (NullTelemetry) RecordEnvelopeAdvisory(AdvisoryReason)              {}
func (NullTelemetry) RecordReceived(string)                              {}
func (NullTelemetry) RecordUnknownEventType()                            {}
func (NullTelemetry) RecordPublish(string, PublishStatus, time.Duration) {}

func (NullTelemetry) Shutdown(context.Context) error { return nil }
