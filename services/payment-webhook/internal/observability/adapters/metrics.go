package adapters

import (
	"context"
	"fmt"
	"time"

	otelmetric "go.opentelemetry.io/otel/metric"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	sdkmetricdata "go.opentelemetry.io/otel/sdk/metric/metricdata"
	"go.opentelemetry.io/otel/sdk/resource"
)

const exportInterval = 15 * time.Second

// MetricsAdapter owns one MeterProvider reading on the push cadence.
type MetricsAdapter struct {
	exporter sdkmetric.Exporter
	provider *sdkmetric.MeterProvider
}

func NewMetricsAdapter(exporter sdkmetric.Exporter) *MetricsAdapter {
	return &MetricsAdapter{exporter: exporter}
}

// Start builds the provider once; a second call is a wiring bug.
func (a *MetricsAdapter) Start(res *resource.Resource) error {
	if a.provider != nil {
		return fmt.Errorf("adapters: the metrics provider already started")
	}
	reader := sdkmetric.NewPeriodicReader(a.exporter, sdkmetric.WithInterval(exportInterval))
	a.provider = sdkmetric.NewMeterProvider(sdkmetric.WithResource(res), sdkmetric.WithReader(reader))
	return nil
}

// Meter returns the started provider's meter; call after Start.
func (a *MetricsAdapter) Meter() (otelmetric.Meter, error) {
	if a.provider == nil {
		return nil, fmt.Errorf("adapters: the metrics provider never started")
	}
	return a.provider.Meter("payment-webhook"), nil
}

// Shutdown stops the periodic reader within its flush cap.
func (a *MetricsAdapter) Shutdown(ctx context.Context) error {
	if a.provider == nil {
		return nil
	}
	provider := a.provider
	a.provider = nil
	drain, cancel := context.WithTimeout(ctx, flushTimeout)
	defer cancel()
	return provider.Shutdown(drain)
}

// DeltaTemporality pins the New Relic wire shape: counters and histograms carry
// per-interval values, the SDK defaults stay cumulative.
func DeltaTemporality(kind sdkmetric.InstrumentKind) sdkmetricdata.Temporality {
	switch kind {
	case sdkmetric.InstrumentKindCounter, sdkmetric.InstrumentKindHistogram:
		return sdkmetricdata.DeltaTemporality
	default:
		return sdkmetricdata.CumulativeTemporality
	}
}
