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

// Boot builds the boot's own telemetry: a blank endpoint resolves to the
// NullTelemetry disabled boot — a legitimate disabled boot in every plane —
// while a set endpoint (whose license-key gate Resolve already owns) pushes
// OTLP/HTTPS with gzip straight to that endpoint. Resource identity and
// sampling ride the resolved config; document-parser's
// build_observability_service is the mirror.
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

// teeHandler fans every slog record onto the stdout text handler and the OTLP
// bridge — the process-wide default keeps its stdout surface while also
// bridging to New Relic (spec: "slog.SetDefault; stdout stays").
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

// Wire mounts the route-span middleware on the engine; the null realization
// carries no instrumenter and installs nothing.
func Wire(t Telemetry, engine *gin.Engine) {
	if instrumenter, ok := t.(engineInstrumenter); ok {
		instrumenter.instrumentEngine(engine)
	}
}

// engineInstrumenter is what the wired build carries so Wire can type-switch;
// the seam itself stays gin-decoupled.
type engineInstrumenter interface {
	instrumentEngine(*gin.Engine)
}
