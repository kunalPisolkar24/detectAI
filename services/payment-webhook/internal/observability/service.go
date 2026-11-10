package observability

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"time"

	"github.com/gin-gonic/gin"
	otelgin "go.opentelemetry.io/contrib/instrumentation/github.com/gin-gonic/gin/otelgin"
	"go.opentelemetry.io/otel/attribute"
	otelmetric "go.opentelemetry.io/otel/metric"
	oteltrace "go.opentelemetry.io/otel/trace"

	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/observability/adapters"
)

// Instrument names are frozen; a rename is a dashboard/alert migration, not an edit.
const (
	InstrumentReceived           = "payment_webhooks_received_total"
	InstrumentPublished          = "payment_events_published_total"
	InstrumentInvalidSignatures  = "payment_webhook_signatures_invalid_total"
	InstrumentUnknownEventType   = "payment_webhooks_unknown_event_type_total"
	InstrumentBodyErrors         = "payment_webhook_body_errors_total"
	InstrumentEnvelopeRejections = "payment_webhook_envelope_rejections_total"
	InstrumentEnvelopeAdvisories = "payment_webhook_envelope_advisories_total"
	InstrumentEnqueueDuration    = "payment_events_enqueue_duration_seconds"
)

// TelemetryService realizes the Telemetry seam on the started SDK providers.
type TelemetryService struct {
	serviceName string
	traces      *adapters.TracesAdapter
	metrics     *adapters.MetricsAdapter
	logs        *adapters.LogsAdapter

	tracer             oteltrace.Tracer
	received           otelmetric.Int64Counter
	published          otelmetric.Int64Counter
	invalidSignatures  otelmetric.Int64Counter
	unknownEventType   otelmetric.Int64Counter
	bodyErrors         otelmetric.Int64Counter
	envelopeRejections otelmetric.Int64Counter
	envelopeAdvisories otelmetric.Int64Counter
	enqueueDuration    otelmetric.Float64Histogram
}

var _ Telemetry = (*TelemetryService)(nil)

func newTelemetryService(serviceName string, traces *adapters.TracesAdapter, metrics *adapters.MetricsAdapter, logs *adapters.LogsAdapter) (*TelemetryService, error) {
	meter, err := metrics.Meter()
	if err != nil {
		return nil, err
	}
	s := &TelemetryService{serviceName: serviceName, traces: traces, metrics: metrics, logs: logs}
	counters := map[string]*otelmetric.Int64Counter{
		InstrumentReceived:           &s.received,
		InstrumentPublished:          &s.published,
		InstrumentInvalidSignatures:  &s.invalidSignatures,
		InstrumentUnknownEventType:   &s.unknownEventType,
		InstrumentBodyErrors:         &s.bodyErrors,
		InstrumentEnvelopeRejections: &s.envelopeRejections,
		InstrumentEnvelopeAdvisories: &s.envelopeAdvisories,
	}
	for name, counter := range counters {
		if *counter, err = meter.Int64Counter(name); err != nil {
			return nil, fmt.Errorf("observability: %s: %w", name, err)
		}
	}
	if s.enqueueDuration, err = meter.Float64Histogram(InstrumentEnqueueDuration); err != nil {
		return nil, fmt.Errorf("observability: %s: %w", InstrumentEnqueueDuration, err)
	}
	s.tracer = s.traces.Provider().Tracer(s.serviceName)
	return s, nil
}

// TrackProcessing opens the app span under the otelgin route span.
func (s *TelemetryService) TrackProcessing(ctx context.Context, eventType, eventID string) (context.Context, func()) {
	ctx, span := s.tracer.Start(ctx, "process", oteltrace.WithAttributes(
		attribute.String("event_type", eventType),
		attribute.String("event_id", eventID),
	))
	return ctx, func() { span.End() }
}

func (s *TelemetryService) RecordBodyError(reason Reason) {
	s.bodyErrors.Add(context.Background(), 1,
		otelmetric.WithAttributes(attribute.String("reason", string(reason))))
}

func (s *TelemetryService) RecordInvalidSignature() {
	s.invalidSignatures.Add(context.Background(), 1)
}

func (s *TelemetryService) RecordEnvelopeRejection(reason string) {
	s.envelopeRejections.Add(context.Background(), 1,
		otelmetric.WithAttributes(attribute.String("reason", reason)))
}

func (s *TelemetryService) RecordEnvelopeAdvisory(reason AdvisoryReason) {
	s.envelopeAdvisories.Add(context.Background(), 1,
		otelmetric.WithAttributes(attribute.String("reason", string(reason))))
}

func (s *TelemetryService) RecordReceived(eventType string) {
	s.received.Add(context.Background(), 1,
		otelmetric.WithAttributes(attribute.String("event_type", eventType)))
}

func (s *TelemetryService) RecordUnknownEventType() {
	s.unknownEventType.Add(context.Background(), 1)
}

// RecordPublish partitions the outcome and times it under one status label.
func (s *TelemetryService) RecordPublish(eventType string, status PublishStatus, duration time.Duration) {
	labels := otelmetric.WithAttributes(
		attribute.String("event_type", eventType),
		attribute.String("status", string(status)),
	)
	s.published.Add(context.Background(), 1, labels)
	s.enqueueDuration.Record(context.Background(), duration.Seconds(), labels)
}

// Shutdown drains each adapter and restores the plain stdout handler without failing the process.
func (s *TelemetryService) Shutdown(ctx context.Context) error {
	err := errors.Join(s.traces.Shutdown(ctx), s.metrics.Shutdown(ctx), s.logs.Shutdown(ctx))
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stdout, nil)))
	return err
}

// instrumentEngine joins otelgin; its route spans frame every app span.
func (s *TelemetryService) instrumentEngine(engine *gin.Engine) {
	engine.Use(otelgin.Middleware(s.serviceName, otelgin.WithTracerProvider(s.traces.Provider())))
}
