package observability_test

import (
	"testing"

	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	sdkmetricdata "go.opentelemetry.io/otel/sdk/metric/metricdata"

	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/observability/adapters"
)

func TestDeltaTemporalityPinsTheWireShape(t *testing.T) {
	for kind, want := range map[sdkmetric.InstrumentKind]sdkmetricdata.Temporality{
		sdkmetric.InstrumentKindCounter:                 sdkmetricdata.DeltaTemporality,
		sdkmetric.InstrumentKindHistogram:               sdkmetricdata.DeltaTemporality,
		sdkmetric.InstrumentKindObservableCounter:       sdkmetricdata.CumulativeTemporality,
		sdkmetric.InstrumentKindUpDownCounter:           sdkmetricdata.CumulativeTemporality,
		sdkmetric.InstrumentKindObservableUpDownCounter: sdkmetricdata.CumulativeTemporality,
		sdkmetric.InstrumentKindGauge:                   sdkmetricdata.CumulativeTemporality,
		sdkmetric.InstrumentKindObservableGauge:         sdkmetricdata.CumulativeTemporality,
	} {
		if got := adapters.DeltaTemporality(kind); got != want {
			t.Errorf("DeltaTemporality(%v) = %v, want %v", kind, got, want)
		}
	}
}
