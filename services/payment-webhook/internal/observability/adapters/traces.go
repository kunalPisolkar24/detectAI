package adapters

import (
	"context"
	"fmt"
	"time"

	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

// flushTimeout caps every single flush: the three drain calls must fit the
// drain window the server already owns.
const flushTimeout = 5 * time.Second

// TracesAdapter owns one TracerProvider started against the shared resource;
// the exporter arrives injected.
type TracesAdapter struct {
	exporter    sdktrace.SpanExporter
	sampleRatio float64
	provider    *sdktrace.TracerProvider
}

// NewTracesAdapter takes the span exporter and the ParentBased sample ratio.
func NewTracesAdapter(exporter sdktrace.SpanExporter, sampleRatio float64) *TracesAdapter {
	return &TracesAdapter{exporter: exporter, sampleRatio: sampleRatio}
}

// Start builds the provider once; a second call is a wiring bug, not a no-op.
func (a *TracesAdapter) Start(res *resource.Resource) error {
	if a.provider != nil {
		return fmt.Errorf("adapters: the traces provider already started")
	}
	a.provider = sdktrace.NewTracerProvider(
		sdktrace.WithResource(res),
		sdktrace.WithSampler(sdktrace.ParentBased(sdktrace.TraceIDRatioBased(a.sampleRatio))),
	)
	a.provider.RegisterSpanProcessor(sdktrace.NewBatchSpanProcessor(a.exporter))
	return nil
}

// Provider exposes the started provider to the seam; call after Start.
func (a *TracesAdapter) Provider() *sdktrace.TracerProvider {
	return a.provider
}

// Shutdown force-flushes without racing the retrying worker past its cap.
func (a *TracesAdapter) Shutdown(ctx context.Context) error {
	if a.provider == nil {
		return nil
	}
	provider := a.provider
	a.provider = nil
	drain, cancel := context.WithTimeout(ctx, flushTimeout)
	defer cancel()
	return provider.Shutdown(drain)
}
