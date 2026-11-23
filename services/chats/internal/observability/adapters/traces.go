package adapters

import (
	"context"
	"fmt"
	"time"

	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

// flushTimeout caps every single flush inside the server's drain window.
const flushTimeout = 5 * time.Second

type TracesAdapter struct {
	exporter    sdktrace.SpanExporter
	sampleRatio float64
	provider    *sdktrace.TracerProvider
}

func NewTracesAdapter(exporter sdktrace.SpanExporter, sampleRatio float64) *TracesAdapter {
	return &TracesAdapter{exporter: exporter, sampleRatio: sampleRatio}
}

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

func (a *TracesAdapter) Provider() *sdktrace.TracerProvider {
	return a.provider
}

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
