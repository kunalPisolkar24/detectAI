package adapters

import (
	"context"
	"fmt"

	sdklog "go.opentelemetry.io/otel/sdk/log"
	"go.opentelemetry.io/otel/sdk/resource"
)

// LogsAdapter owns one LoggerProvider started against the shared resource; the
// exporter arrives injected. The slog bridge assembles in the boot — every
// slog line then flows to OTLP and stdout both.
type LogsAdapter struct {
	exporter sdklog.Exporter
	provider *sdklog.LoggerProvider
}

// NewLogsAdapter takes the log record exporter.
func NewLogsAdapter(exporter sdklog.Exporter) *LogsAdapter {
	return &LogsAdapter{exporter: exporter}
}

// Start builds the provider once; a second call is a wiring bug, not a no-op.
func (a *LogsAdapter) Start(res *resource.Resource) error {
	if a.provider != nil {
		return fmt.Errorf("adapters: the logs provider already started")
	}
	a.provider = sdklog.NewLoggerProvider(
		sdklog.WithResource(res),
		sdklog.WithProcessor(sdklog.NewBatchProcessor(a.exporter)),
	)
	return nil
}

// Provider exposes the started provider to the bridge assembly; call after Start.
func (a *LogsAdapter) Provider() *sdklog.LoggerProvider {
	return a.provider
}

// Shutdown stops the batching worker within its flush cap.
func (a *LogsAdapter) Shutdown(ctx context.Context) error {
	if a.provider == nil {
		return nil
	}
	provider := a.provider
	a.provider = nil
	drain, cancel := context.WithTimeout(ctx, flushTimeout)
	defer cancel()
	return provider.Shutdown(drain)
}
