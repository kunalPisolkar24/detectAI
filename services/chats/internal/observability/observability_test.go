package observability

import (
	"context"
	"testing"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/config"
	"go.opentelemetry.io/otel/trace"
)

func TestBuildResourceDefaults(t *testing.T) {
	t.Setenv("OTEL_RESOURCE_ATTRIBUTES", "")
	t.Setenv("DEPLOYMENT_ENV", "")
	res, err := BuildResource(&config.Config{EnvType: "dev"})
	if err != nil {
		t.Fatalf("BuildResource failed: %v", err)
	}
	attrs := map[string]string{}
	for _, a := range res.Attributes() {
		attrs[string(a.Key)] = a.Value.AsString()
	}
	if attrs["service.name"] != "chat-service" {
		t.Fatalf("default service.name = %q", attrs["service.name"])
	}
	if attrs["service.version"] != "dev" {
		t.Fatalf("default service.version = %q", attrs["service.version"])
	}
	if attrs["deployment.environment"] != "dev" {
		t.Fatalf("default deployment.environment = %q", attrs["deployment.environment"])
	}
}

func TestBuildResourceEnvWins(t *testing.T) {
	t.Setenv("OTEL_RESOURCE_ATTRIBUTES", "deployment.environment=loadtest,team=chats")
	t.Setenv("DEPLOYMENT_ENV", "prod")
	t.Setenv("OTEL_SERVICE_VERSION", "9.9.9")
	res, err := BuildResource(&config.Config{
		EnvType:            "dev",
		OtelServiceName:    "chat-worker",
		OtelServiceVersion: "9.9.9",
	})
	if err != nil {
		t.Fatalf("BuildResource failed: %v", err)
	}
	attrs := map[string]string{}
	for _, a := range res.Attributes() {
		attrs[string(a.Key)] = a.Value.AsString()
	}
	if attrs["service.name"] != "chat-worker" {
		t.Fatalf("service.name = %q", attrs["service.name"])
	}
	if attrs["deployment.environment"] != "loadtest" {
		t.Fatalf("OTEL_RESOURCE_ATTRIBUTES must win, got %q", attrs["deployment.environment"])
	}
}

func TestInitTracingNoEndpointIsNoop(t *testing.T) {
	shutdown, err := InitTracing(&config.Config{OtelEndpoint: ""})
	if err != nil {
		t.Fatalf("empty endpoint must be fail-open, got %v", err)
	}
	if err := shutdown(context.Background()); err != nil {
		t.Fatalf("noop shutdown must not fail, got %v", err)
	}
}

func TestTraceFieldsEmptyWithoutSpan(t *testing.T) {
	if got := TraceFields(context.Background()); got != nil {
		t.Fatalf("background ctx must yield no fields, got %v", got)
	}
}

func TestTraceFieldsCarrySpanIDs(t *testing.T) {
	sc := trace.NewSpanContext(trace.SpanContextConfig{
		TraceID:    mustTraceID(t, "4bf92f3577b34da6a3ce929d0e0e4736"),
		SpanID:     mustSpanID(t, "00f067aa0ba902b7"),
		TraceFlags: trace.FlagsSampled,
		Remote:     true,
	})
	ctx := trace.ContextWithSpanContext(context.Background(), sc)
	fields := TraceFields(ctx)
	if len(fields) != 2 {
		t.Fatalf("expected trace+span fields, got %v", fields)
	}
}

func mustTraceID(t *testing.T, s string) [16]byte {
	t.Helper()
	id, err := trace.TraceIDFromHex(s)
	if err != nil {
		t.Fatalf("bad trace id: %v", err)
	}
	return id
}

func mustSpanID(t *testing.T, s string) [8]byte {
	t.Helper()
	id, err := trace.SpanIDFromHex(s)
	if err != nil {
		t.Fatalf("bad span id: %v", err)
	}
	return id
}
