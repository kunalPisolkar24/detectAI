package observability

import (
	"context"
	"fmt"
	"log/slog"
	"os"

	"github.com/gin-gonic/gin"
	"go.opentelemetry.io/contrib/bridges/otelslog"
	otlploghttp "go.opentelemetry.io/otel/exporters/otlp/otlplog/otlploghttp"
	otlpmetrichttp "go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp"
	otlptracehttp "go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"

	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/config"
	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/observability/adapters"
)

// Boot switches on the endpoint: blank returns NullTelemetry, set pushes OTLP/HTTPS gzip.
func Boot(cfg config.Config, flick string) (Telemetry, error) {
	if cfg.OTelEndpoint == "" {
		return NullTelemetry{}, nil
	}
	ctx := context.Background()
	headers := authHeaders(cfg.NewRelicKey)

	traceExporter, err := otlptracehttp.New(ctx,
		otlptracehttp.WithEndpointURL(signalURL(cfg.OTelEndpoint, tracesSignal)),
		otlptracehttp.WithHeaders(headers),
		otlptracehttp.WithCompression(otlptracehttp.GzipCompression),
	)
	if err != nil {
		return nil, fmt.Errorf("observability: traces exporter: %w", err)
	}
	metricExporter, err := otlpmetrichttp.New(ctx,
		otlpmetrichttp.WithEndpointURL(signalURL(cfg.OTelEndpoint, metricsSignal)),
		otlpmetrichttp.WithHeaders(headers),
		otlpmetrichttp.WithCompression(otlpmetrichttp.GzipCompression),
		otlpmetrichttp.WithTemporalitySelector(adapters.DeltaTemporality),
	)
	if err != nil {
		return nil, fmt.Errorf("observability: metrics exporter: %w", err)
	}
	logExporter, err := otlploghttp.New(ctx,
		otlploghttp.WithEndpointURL(signalURL(cfg.OTelEndpoint, logsSignal)),
		otlploghttp.WithHeaders(headers),
		otlploghttp.WithCompression(otlploghttp.GzipCompression),
	)
	if err != nil {
		return nil, fmt.Errorf("observability: logs exporter: %w", err)
	}

	res := buildResource(cfg.OTelName, cfg.OTelVersion, flick)
	traces := adapters.NewTracesAdapter(traceExporter, cfg.OTelSampleRatio)
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
	slog.SetDefault(slog.New(teeHandler{
		stdout: slog.NewTextHandler(os.Stdout, nil),
		otlp:   otelslog.NewHandler(cfg.OTelName, otelslog.WithLoggerProvider(logs.Provider())),
	}))

	service, err := newTelemetryService(cfg.OTelName, traces, metrics, logs)
	if err != nil {
		return nil, err
	}
	return service, nil
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
