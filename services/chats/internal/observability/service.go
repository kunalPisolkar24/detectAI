package observability

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	otelgin "go.opentelemetry.io/contrib/instrumentation/github.com/gin-gonic/gin/otelgin"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	otelmetric "go.opentelemetry.io/otel/metric"
	oteltrace "go.opentelemetry.io/otel/trace"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/observability/adapters"
)

// Instrument names are frozen; a rename is a dashboard/alert migration, not an edit.
const (
	InstrumentRPCRequests          = "chats_rpc_requests_total"
	InstrumentRPCErrors            = "chats_rpc_errors_total"
	InstrumentRPCDuration          = "chats_rpc_duration_seconds"
	InstrumentCacheOperations      = "chats_cache_operations_total"
	InstrumentCacheDuration        = "chats_cache_operation_duration_seconds"
	InstrumentDatastoreOperations  = "chats_datastore_operations_total"
	InstrumentDatastoreDuration    = "chats_datastore_operation_duration_seconds"
	InstrumentRateLimitRefusals    = "chats_rate_limit_refusals_total"
	InstrumentValidationRejections = "chats_validation_rejections_total"
)

// The RPC semantic conventions the procedure spans carry.
const (
	attributeRPCSystem    = "rpc.system"
	attributeRPCService   = "rpc.service"
	attributeRPCMethod    = "rpc.method"
	attributeRPCErrorCode = "rpc.connect_rpc.error_code"

	rpcSystemConnectRPC = "connect_rpc"
)

// TelemetryService realizes the Telemetry seam on the started SDK providers.
type TelemetryService struct {
	serviceName string
	traces      *adapters.TracesAdapter
	metrics     *adapters.MetricsAdapter
	logs        *adapters.LogsAdapter

	tracer               oteltrace.Tracer
	rpcRequests          otelmetric.Int64Counter
	rpcErrors            otelmetric.Int64Counter
	rpcDuration          otelmetric.Float64Histogram
	cacheOperations      otelmetric.Int64Counter
	cacheDuration        otelmetric.Float64Histogram
	datastoreOperations  otelmetric.Int64Counter
	datastoreDuration    otelmetric.Float64Histogram
	rateLimitRefusals    otelmetric.Int64Counter
	validationRejections otelmetric.Int64Counter
}

var _ Telemetry = (*TelemetryService)(nil)

func newTelemetryService(serviceName string, traces *adapters.TracesAdapter, metrics *adapters.MetricsAdapter, logs *adapters.LogsAdapter) (*TelemetryService, error) {
	meter, err := metrics.Meter()
	if err != nil {
		return nil, err
	}
	s := &TelemetryService{serviceName: serviceName, traces: traces, metrics: metrics, logs: logs}
	counters := map[string]*otelmetric.Int64Counter{
		InstrumentRPCRequests:          &s.rpcRequests,
		InstrumentRPCErrors:            &s.rpcErrors,
		InstrumentCacheOperations:      &s.cacheOperations,
		InstrumentDatastoreOperations:  &s.datastoreOperations,
		InstrumentRateLimitRefusals:    &s.rateLimitRefusals,
		InstrumentValidationRejections: &s.validationRejections,
	}
	for name, counter := range counters {
		if *counter, err = meter.Int64Counter(name); err != nil {
			return nil, fmt.Errorf("observability: %s: %w", name, err)
		}
	}
	histograms := map[string]*otelmetric.Float64Histogram{
		InstrumentRPCDuration:       &s.rpcDuration,
		InstrumentCacheDuration:     &s.cacheDuration,
		InstrumentDatastoreDuration: &s.datastoreDuration,
	}
	for name, histogram := range histograms {
		if *histogram, err = meter.Float64Histogram(name); err != nil {
			return nil, fmt.Errorf("observability: %s: %w", name, err)
		}
	}
	s.tracer = s.traces.Provider().Tracer(s.serviceName)
	return s, nil
}

// TrackRPC opens the procedure's server span under the gin route span; the closer
// ends it with the RPC's final status.
func (s *TelemetryService) TrackRPC(ctx context.Context, procedure string) (context.Context, func(RPCStatus)) {
	ctx, span := s.tracer.Start(ctx, strings.TrimPrefix(procedure, "/"), oteltrace.WithAttributes(
		attribute.String(attributeRPCSystem, rpcSystemConnectRPC),
		attribute.String(attributeRPCService, serviceOf(procedure)),
		attribute.String(attributeRPCMethod, methodOf(procedure)),
	))
	return ctx, func(status RPCStatus) {
		if status != RPCStatusOK {
			span.SetStatus(codes.Error, string(status))
			span.SetAttributes(attribute.String(attributeRPCErrorCode, string(status)))
		}
		span.End()
	}
}

// RecordRPC counts the answer and times it; the error counter takes only the failures.
func (s *TelemetryService) RecordRPC(procedure string, code RPCStatus, duration time.Duration) {
	method := methodOf(procedure)
	s.rpcRequests.Add(context.Background(), 1, otelmetric.WithAttributes(
		attribute.String("procedure", method),
		attribute.String("code", string(code)),
	))
	if code != RPCStatusOK {
		s.rpcErrors.Add(context.Background(), 1, otelmetric.WithAttributes(
			attribute.String("procedure", method),
			attribute.String("code", string(code)),
		))
	}
	s.rpcDuration.Record(context.Background(), duration.Seconds(),
		otelmetric.WithAttributes(attribute.String("procedure", method)))
}

// RecordCacheOp counts one cache operation and times it.
func (s *TelemetryService) RecordCacheOp(operation string, result CacheResult, duration time.Duration) {
	s.cacheOperations.Add(context.Background(), 1, otelmetric.WithAttributes(
		attribute.String("operation", operation),
		attribute.String("result", string(result)),
	))
	s.cacheDuration.Record(context.Background(), duration.Seconds(),
		otelmetric.WithAttributes(attribute.String("operation", operation)))
}

// RecordDatastoreOp counts one datastore operation and times it.
func (s *TelemetryService) RecordDatastoreOp(operation string, result DatastoreResult, duration time.Duration) {
	s.datastoreOperations.Add(context.Background(), 1, otelmetric.WithAttributes(
		attribute.String("operation", operation),
		attribute.String("result", string(result)),
	))
	s.datastoreDuration.Record(context.Background(), duration.Seconds(),
		otelmetric.WithAttributes(attribute.String("operation", operation)))
}

// RecordRateLimitRefusal counts one exhausted burst budget.
func (s *TelemetryService) RecordRateLimitRefusal(scope string) {
	s.rateLimitRefusals.Add(context.Background(), 1,
		otelmetric.WithAttributes(attribute.String("scope", scope)))
}

// RecordValidationRejection counts one rejected payload field.
func (s *TelemetryService) RecordValidationRejection(field string) {
	s.validationRejections.Add(context.Background(), 1,
		otelmetric.WithAttributes(attribute.String("field", field)))
}

// instrumentEngine joins otelgin; its route spans frame every RPC span.
func (s *TelemetryService) instrumentEngine(engine *gin.Engine) {
	engine.Use(otelgin.Middleware(s.serviceName, otelgin.WithTracerProvider(s.traces.Provider())))
}

// Shutdown drains each adapter and restores the plain stdout handler without failing the process.
func (s *TelemetryService) Shutdown(ctx context.Context) error {
	err := errors.Join(s.traces.Shutdown(ctx), s.metrics.Shutdown(ctx), s.logs.Shutdown(ctx))
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	return err
}

// methodOf returns the procedure's method name: the segment after the last slash.
func methodOf(procedure string) string {
	if index := strings.LastIndex(procedure, "/"); index >= 0 {
		return procedure[index+1:]
	}
	return procedure
}

// serviceOf returns the procedure's service name: the segment before the last slash.
func serviceOf(procedure string) string {
	if index := strings.LastIndex(procedure, "/"); index > 0 {
		return strings.TrimPrefix(procedure[:index], "/")
	}
	return ""
}
