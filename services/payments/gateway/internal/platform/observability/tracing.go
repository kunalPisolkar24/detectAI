package observability

import (
	"context"
	"strings"

	"github.com/kunalPisolkar24/detectAI/services/payments/gateway/internal/config"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

func InitTracing(cfg *config.Config) (func(context.Context) error, error) {
	if strings.TrimSpace(cfg.OtelEndpoint) == "" {
		return func(context.Context) error { return nil }, nil
	}
	serviceName := cfg.OtelServiceName
	if serviceName == "" {
		serviceName = "payment-gateway"
	}
	ctx := context.Background()
	// OtelEndpoint is a full base URL (http://otel-collector:4318); WithEndpoint
	// takes host:port only, so use WithEndpointURL with the traces path.
	url := strings.TrimSuffix(strings.TrimSpace(cfg.OtelEndpoint), "/") + "/v1/traces"
	exporter, err := otlptracehttp.New(ctx, otlptracehttp.WithEndpointURL(url))
	if err != nil {
		return nil, err
	}
	res, err := resource.Merge(resource.Default(), resource.NewSchemaless(attribute.String("service.name", serviceName)))
	if err != nil {
		return nil, err
	}
	tp := sdktrace.NewTracerProvider(sdktrace.WithBatcher(exporter), sdktrace.WithResource(res))
	otel.SetTracerProvider(tp)
	otel.SetTextMapPropagator(propagation.TraceContext{})
	return tp.Shutdown, nil
}
