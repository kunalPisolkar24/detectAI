package observability

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/config"
	"github.com/kunalPisolkar24/detectAI/services/chats/pkg/logger"
	"go.opentelemetry.io/otel/exporters/otlp/otlplog/otlploghttp"
	"go.opentelemetry.io/otel/log"
	sdklog "go.opentelemetry.io/otel/sdk/log"
	"go.opentelemetry.io/otel/trace"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

// InitObservableLogger keeps JSON logs on stdout and, when
// OTEL_EXPORTER_OTLP_ENDPOINT is set, also forwards them to the collector
// over OTLP/HTTP (/v1/logs). Fail-open: without an endpoint (or when the
// exporter cannot be built) stdout logging is unaffected and shutdown is a
// no-op, so the service never fails to start for telemetry reasons.
func InitObservableLogger(level string, cfg *config.Config) func(context.Context) error {
	noop := func(context.Context) error { return nil }
	logger.Init(level)
	if strings.TrimSpace(cfg.OtelEndpoint) == "" {
		return noop
	}
	core, shutdown, err := newOTLPCore(context.Background(), cfg)
	if err != nil {
		if logger.Log != nil {
			logger.Log.Warn("Log export disabled, continuing with stdout logs", zap.Error(err))
		}
		return noop
	}
	logger.AttachCore(core)
	return shutdown
}

func newOTLPCore(ctx context.Context, cfg *config.Config) (zapcore.Core, func(context.Context) error, error) {
	noop := func(context.Context) error { return nil }
	url := strings.TrimSuffix(strings.TrimSpace(cfg.OtelEndpoint), "/") + "/v1/logs"
	exporter, err := otlploghttp.New(ctx, otlploghttp.WithEndpointURL(url))
	if err != nil {
		return nil, noop, err
	}
	res, err := BuildResource(cfg)
	if err != nil {
		return nil, noop, err
	}
	provider := sdklog.NewLoggerProvider(
		sdklog.WithResource(res),
		sdklog.WithProcessor(sdklog.NewBatchProcessor(exporter)),
	)
	name := strings.TrimSpace(cfg.OtelServiceName)
	if name == "" {
		name = "chat-service"
	}
	level := zapcore.InfoLevel
	if logger.Log != nil {
		level = logger.Log.Level()
	}
	return &otlpCore{emitter: provider.Logger(name), level: level}, provider.Shutdown, nil
}

// TraceFields returns trace_id/span_id fields for the span in ctx so zap
// lines stay correlatable with traces. Empty when no span is present.
// newOTLPCore lifts the same values onto the OTLP record's trace context.
func TraceFields(ctx context.Context) []zap.Field {
	sc := trace.SpanFromContext(ctx).SpanContext()
	if !sc.IsValid() {
		return nil
	}
	return []zap.Field{
		zap.String("trace_id", sc.TraceID().String()),
		zap.String("span_id", sc.SpanID().String()),
	}
}

// otlpCore is a zapcore.Core forwarding entries to an OTel logger.
type otlpCore struct {
	emitter log.Logger
	level   zapcore.Level
}

func (c *otlpCore) Enabled(lvl zapcore.Level) bool { return lvl >= c.level }

func (c *otlpCore) With(fields []zapcore.Field) zapcore.Core { return c }

func (c *otlpCore) Check(entry zapcore.Entry, ce *zapcore.CheckedEntry) *zapcore.CheckedEntry {
	if c.Enabled(entry.Level) {
		return ce.AddCore(entry, c)
	}
	return ce
}

func (c *otlpCore) Write(entry zapcore.Entry, fields []zapcore.Field) error {
	rec := log.Record{}
	emitCtx := context.Background()
	rec.SetTimestamp(entry.Time)
	if entry.Time.IsZero() {
		rec.SetTimestamp(time.Now().UTC())
	}
	rec.SetSeverity(mapSeverity(entry.Level))
	rec.SetSeverityText(entry.Level.CapitalString())
	rec.SetBody(log.StringValue(entry.Message))

	enc := zapcore.NewMapObjectEncoder()
	for _, f := range fields {
		f.AddTo(enc)
	}
	var traceID trace.TraceID
	var spanID trace.SpanID
	for k, v := range enc.Fields {
		switch k {
		case "trace_id":
			if s, ok := v.(string); ok {
				if id, err := trace.TraceIDFromHex(s); err == nil {
					traceID = id
				}
			}
			continue
		case "span_id":
			if s, ok := v.(string); ok {
				if id, err := trace.SpanIDFromHex(s); err == nil {
					spanID = id
				}
			}
			continue
		}
		rec.AddAttributes(log.String(k, sprintValue(v)))
	}
	if loggerName := entry.LoggerName; loggerName != "" {
		rec.AddAttributes(log.String("logger", loggerName))
	}
	if entry.Caller.Defined {
		rec.AddAttributes(log.String("caller", entry.Caller.TrimmedPath()))
	}
	if entry.Stack != "" {
		rec.AddAttributes(log.String("stack", entry.Stack))
	}
	if traceID.IsValid() && spanID.IsValid() {
		emitCtx = trace.ContextWithSpanContext(emitCtx, trace.NewSpanContext(trace.SpanContextConfig{
			TraceID:    traceID,
			SpanID:     spanID,
			TraceFlags: trace.FlagsSampled,
			Remote:     true,
		}))
	}
	c.emitter.Emit(emitCtx, rec)
	return nil
}

func (c *otlpCore) Sync() error { return nil }

func mapSeverity(l zapcore.Level) log.Severity {
	switch {
	case l >= zapcore.ErrorLevel:
		return log.SeverityError
	case l >= zapcore.WarnLevel:
		return log.SeverityWarn
	case l >= zapcore.InfoLevel:
		return log.SeverityInfo
	default:
		return log.SeverityDebug
	}
}

func sprintValue(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	return fmt.Sprintf("%v", v)
}
