package observability

import (
	"context"
	"fmt"
	"log/slog"
	"os"

	"github.com/gin-gonic/gin"
	"go.opentelemetry.io/contrib/bridges/otelslog"
	"go.opentelemetry.io/otel"
	otlploghttp "go.opentelemetry.io/otel/exporters/otlp/otlplog/otlploghttp"
	otlpmetrichttp "go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp"
	otlptracehttp "go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/propagation"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/observability/adapters"
)

const (
	defaultServiceName    = "chats"
	defaultServiceVersion = "dev"
	defaultSampleRatio    = 1.0
)

// Config is the observability slice of the boot config; the rest of the boot
// config never reaches this package.
type Config struct {
	Endpoint       string
	LicenseKey     string
	ServiceName    string
	ServiceVersion string
	SampleRatio    float64
}

// Boot switches on the endpoint: blank returns NullTelemetry, set pushes OTLP/HTTPS gzip.
func Boot(cfg Config, flick string) (Telemetry, error) {
	if cfg.Endpoint == "" {
		return NullTelemetry{}, nil
	}
	ctx := context.Background()
	headers := authHeaders(cfg.LicenseKey)

	traceExporter, err := otlptracehttp.New(ctx,
		otlptracehttp.WithEndpointURL(signalURL(cfg.Endpoint, tracesSignal)),
		otlptracehttp.WithHeaders(headers),
		otlptracehttp.WithCompression(otlptracehttp.GzipCompression),
	)
	if err != nil {
		return nil, fmt.Errorf("observability: traces exporter: %w", err)
	}
	metricExporter, err := otlpmetrichttp.New(ctx,
		otlpmetrichttp.WithEndpointURL(signalURL(cfg.Endpoint, metricsSignal)),
		otlpmetrichttp.WithHeaders(headers),
		otlpmetrichttp.WithCompression(otlpmetrichttp.GzipCompression),
		otlpmetrichttp.WithTemporalitySelector(adapters.DeltaTemporality),
	)
	if err != nil {
		return nil, fmt.Errorf("observability: metrics exporter: %w", err)
	}
	logExporter, err := otlploghttp.New(ctx,
		otlploghttp.WithEndpointURL(signalURL(cfg.Endpoint, logsSignal)),
		otlploghttp.WithHeaders(headers),
		otlploghttp.WithCompression(otlploghttp.GzipCompression),
	)
	if err != nil {
		return nil, fmt.Errorf("observability: logs exporter: %w", err)
	}

	res := buildResource(serviceName(cfg), serviceVersion(cfg), flick)
	traces := adapters.NewTracesAdapter(traceExporter, sampleRatio(cfg))
	if err := traces.Start(res); err != nil {
		return nil, err
	}
	metrics := adapters.NewMetricsAdapter(metricExporter)
	if err := metrics.Start(res); err != nil {
		return nil, err
	}
	logs := adapters.NewLogsAdapter(logExporter)
	if err := logs.Start(res); err != nil {
		return nil, err
	}
	// The SDK's global propagator is a no-op until one is registered, and
	// otelgin reads it when the middleware is built: without this the inbound
	// traceparent is dropped and every request starts an orphan trace. The
	// global tracer follows it so anything reaching for otel.Tracer lands in
	// this pipeline rather than in a second one.
	otel.SetTextMapPropagator(propagation.TraceContext{})
	otel.SetTracerProvider(traces.Provider())
	name := serviceName(cfg)
	slog.SetDefault(slog.New(teeHandler{
		stdout: slog.NewJSONHandler(os.Stdout, nil),
		otlp:   otelslog.NewHandler(name, otelslog.WithLoggerProvider(logs.Provider())),
	}))

	service, err := newTelemetryService(name, traces, metrics, logs)
	if err != nil {
		return nil, err
	}
	return service, nil
}

// The resource identity falls back to the service's own defaults rather than
// shipping an empty service.name into New Relic.
func serviceName(cfg Config) string {
	if cfg.ServiceName == "" {
		return defaultServiceName
	}
	return cfg.ServiceName
}

func serviceVersion(cfg Config) string {
	if cfg.ServiceVersion == "" {
		return defaultServiceVersion
	}
	return cfg.ServiceVersion
}

func sampleRatio(cfg Config) float64 {
	if cfg.SampleRatio <= 0 {
		return defaultSampleRatio
	}
	return cfg.SampleRatio
}

// teeHandler fans every slog record to stdout and the OTLP bridge.
type teeHandler struct {
	stdout slog.Handler
	otlp   slog.Handler
}

func (t teeHandler) Enabled(ctx context.Context, level slog.Level) bool {
	return t.stdout.Enabled(ctx, level) || t.otlp.Enabled(ctx, level)
}

func (t teeHandler) Handle(ctx context.Context, record slog.Record) error {
	if err := t.stdout.Handle(ctx, record.Clone()); err != nil {
		return err
	}
	return t.otlp.Handle(ctx, record)
}

func (t teeHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	return teeHandler{stdout: t.stdout.WithAttrs(attrs), otlp: t.otlp.WithAttrs(attrs)}
}

func (t teeHandler) WithGroup(name string) slog.Handler {
	return teeHandler{stdout: t.stdout.WithGroup(name), otlp: t.otlp.WithGroup(name)}
}

// Wire installs the route-span middleware on a wired boot; the null boot installs nothing.
func Wire(t Telemetry, engine *gin.Engine) {
	if instrumenter, ok := t.(engineInstrumenter); ok {
		instrumenter.instrumentEngine(engine)
	}
}

// engineInstrumenter is what the wired build carries so Wire can type-switch.
type engineInstrumenter interface {
	instrumentEngine(*gin.Engine)
}
