package observability

import (
	"context"
	"time"
)

// NullTelemetry is the disabled boot for an unset OTEL_EXPORTER_OTLP_ENDPOINT.
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
