package observability

import (
	"context"
	"log/slog"
	"os"
	"strings"

	"github.com/kunalPisolkar24/detectAI/services/payments/gateway/internal/config"
	"github.com/kunalPisolkar24/detectAI/services/payments/gateway/internal/ports"
	"go.opentelemetry.io/contrib/bridges/otelslog"
	"go.opentelemetry.io/otel/exporters/otlp/otlplog/otlploghttp"
	sdklog "go.opentelemetry.io/otel/sdk/log"
	"go.opentelemetry.io/otel/trace"
)

func NewLogger(level string) ports.Logger {
	return slog.New(newStdoutHandler(level))
}

func NewNopLogger() ports.Logger {
	return slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelError}))
}

// NewObservableLogger keeps JSON logs on stdout and, when
// OTEL_EXPORTER_OTLP_ENDPOINT is set, also forwards them to the collector
// over OTLP/HTTP (/v1/logs). Fail-open: without an endpoint (or when the
// exporter cannot be built) it returns the stdout logger with a no-op
// shutdown, so the service keeps running and logs are never lost.
func NewObservableLogger(level string, cfg *config.Config) (ports.Logger, func(context.Context) error, error) {
	noop := func(context.Context) error { return nil }
	stdout := slog.New(newStdoutHandler(level))
	if strings.TrimSpace(cfg.OtelEndpoint) == "" {
		return stdout, noop, nil
	}
	ctx := context.Background()
	url := strings.TrimSuffix(strings.TrimSpace(cfg.OtelEndpoint), "/") + "/v1/logs"
	exporter, err := otlploghttp.New(ctx, otlploghttp.WithEndpointURL(url))
	if err != nil {
		return stdout, noop, err
	}
	res, err := BuildResource(cfg)
	if err != nil {
		return stdout, noop, err
	}
	provider := sdklog.NewLoggerProvider(
		sdklog.WithResource(res),
		sdklog.WithProcessor(sdklog.NewBatchProcessor(exporter)),
	)
	otelHandler := otelslog.NewHandler("payment-gateway", otelslog.WithLoggerProvider(provider))
	return slog.New(&fanoutHandler{handlers: []slog.Handler{newStdoutHandler(level), otelHandler}}), provider.Shutdown, nil
}

func newStdoutHandler(level string) slog.Handler {
	return &traceHandler{next: slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: parseLevel(level)})}
}

func parseLevel(level string) slog.Level {
	switch strings.ToLower(level) {
	case "debug":
		return slog.LevelDebug
	case "warn":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}

// traceHandler enriches stdout records with the current span's trace and
// span IDs so logs stay correlatable with traces once call sites pass a
// context carrying a span. No-op for background contexts.
type traceHandler struct {
	next slog.Handler
}

func (h *traceHandler) Enabled(ctx context.Context, l slog.Level) bool {
	return h.next.Enabled(ctx, l)
}

func (h *traceHandler) Handle(ctx context.Context, r slog.Record) error {
	if sc := trace.SpanFromContext(ctx).SpanContext(); sc.IsValid() {
		r.AddAttrs(
			slog.String("trace_id", sc.TraceID().String()),
			slog.String("span_id", sc.SpanID().String()),
		)
	}
	return h.next.Handle(ctx, r)
}

func (h *traceHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	return &traceHandler{next: h.next.WithAttrs(attrs)}
}

func (h *traceHandler) WithGroup(name string) slog.Handler {
	return &traceHandler{next: h.next.WithGroup(name)}
}

// fanoutHandler delivers each record to every wrapped handler that is
// enabled for the record level, so per-handler levels stay independent.
type fanoutHandler struct {
	handlers []slog.Handler
}

func (f *fanoutHandler) Enabled(ctx context.Context, l slog.Level) bool {
	for _, h := range f.handlers {
		if h.Enabled(ctx, l) {
			return true
		}
	}
	return false
}

func (f *fanoutHandler) Handle(ctx context.Context, r slog.Record) error {
	var firstErr error
	for _, h := range f.handlers {
		if !h.Enabled(ctx, r.Level) {
			continue
		}
		if err := h.Handle(ctx, r); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	return firstErr
}

func (f *fanoutHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	next := make([]slog.Handler, 0, len(f.handlers))
	for _, h := range f.handlers {
		next = append(next, h.WithAttrs(attrs))
	}
	return &fanoutHandler{handlers: next}
}

func (f *fanoutHandler) WithGroup(name string) slog.Handler {
	next := make([]slog.Handler, 0, len(f.handlers))
	for _, h := range f.handlers {
		next = append(next, h.WithGroup(name))
	}
	return &fanoutHandler{handlers: next}
}
