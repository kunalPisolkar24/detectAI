package observability_test

import (
	"bytes"
	"compress/gzip"
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	tracev1 "go.opentelemetry.io/proto/otlp/collector/trace/v1"
	commonv1 "go.opentelemetry.io/proto/otlp/common/v1"
	"google.golang.org/protobuf/proto"

	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/config"
	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/observability"
)

// The receiver swallows OTLP POSTs on the three signal paths inside the test
// process: the units stay network-free, mirroring document-parser's build
// tests, which point the service at a local receiver instead of New Relic.
type otlpReceiver struct {
	t        *testing.T
	endpoint string
	mu       sync.Mutex
	counts   map[string]int
	bodies   map[string][][]byte
}

func newOTLPReceiver(t *testing.T) *otlpReceiver {
	t.Helper()
	receiver := &otlpReceiver{t: t, counts: map[string]int{}, bodies: map[string][][]byte{}}
	mux := http.NewServeMux()
	mux.HandleFunc("/v1/traces", receiver.collect)
	mux.HandleFunc("/v1/metrics", receiver.collect)
	mux.HandleFunc("/v1/logs", receiver.collect)
	server := httptest.NewServer(mux)
	receiver.endpoint = server.URL
	t.Cleanup(server.Close)
	return receiver
}

func (r *otlpReceiver) collect(w http.ResponseWriter, req *http.Request) {
	body, err := io.ReadAll(req.Body)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	r.mu.Lock()
	r.counts[req.URL.Path]++
	r.bodies[req.URL.Path] = append(r.bodies[req.URL.Path], body)
	r.mu.Unlock()
	w.WriteHeader(http.StatusOK)
}

func (r *otlpReceiver) hits(path string) int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.counts[path]
}

func (r *otlpReceiver) payloads(path string) [][]byte {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.bodies[path]
}

// mapSource is the test-plane source Resolve reads from.
type mapSource map[string]string

func (s mapSource) Get(key string) (string, bool) {
	value, ok := s[key]
	return value, ok
}

// resolvePlane boots through the real config: every observability field rides
// Resolve's defaults, so each test composes the values the way the process
// does, with extras carrying the per-case keys.
func resolvePlane(t *testing.T, extra map[string]string) config.Config {
	t.Helper()
	source := map[string]string{
		"PADDLE_WEBHOOK_SECRET": "paddle-change-me-16-chars",
		"QUEUE_URL":             "https://sqs.eu-central-1.amazonaws.com/123456789012/payment_events.fifo",
	}
	for key, value := range extra {
		source[key] = value
	}
	cfg, err := config.Resolve(mapSource(source))
	if err != nil {
		t.Fatalf("resolving the boot plane: %v", err)
	}
	return cfg
}

func TestBootWithoutEndpointBuildsTheNullBoot(t *testing.T) {
	tel, err := observability.Boot(resolvePlane(t, nil), "dev")
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := tel.(observability.NullTelemetry); !ok {
		t.Fatalf("Boot = %T, want NullTelemetry for the blank endpoint", tel)
	}
	engine := gin.New()
	before := len(engine.Handlers)
	observability.Wire(tel, engine)
	if len(engine.Handlers) != before {
		t.Errorf("Wire on the null boot grew the middleware chain by %d, want it untouched",
			len(engine.Handlers)-before)
	}
	if err := tel.Shutdown(context.Background()); err != nil {
		t.Errorf("Shutdown = %v, want silent success since nothing was built", err)
	}
}

func TestWiredBootPushesAllThreeSignals(t *testing.T) {
	receiver := newOTLPReceiver(t)
	cfg := resolvePlane(t, map[string]string{
		"OTEL_EXPORTER_OTLP_ENDPOINT": receiver.endpoint,
		"NEW_RELIC_LICENSE_KEY":       "unit-test-license-key-16",
		"OTEL_SERVICE_NAME":           "payment-webhook-test",
		"OTEL_SERVICE_VERSION":        "1.2.3",
	})
	tel, err := observability.Boot(cfg, "prod")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = tel.Shutdown(context.Background()) })

	if _, ok := tel.(*observability.TelemetryService); !ok {
		t.Fatalf("Boot = %T, want the wired *TelemetryService", tel)
	}
	engine := gin.New()
	before := len(engine.Handlers)
	observability.Wire(tel, engine)
	if len(engine.Handlers) <= before {
		t.Error("Wire on the wired boot left the middleware chain untouched; want otelgin joined")
	}
	engine.GET("/v1/check", func(c *gin.Context) { c.Status(http.StatusOK) })
	res := httptest.NewRecorder()
	engine.ServeHTTP(res, httptest.NewRequest(http.MethodGet, "/v1/check", nil))
	if res.Code != http.StatusOK {
		t.Errorf("route through the wired engine = %d, want 200 with otelgin pass-through", res.Code)
	}

	appCtx, end := tel.TrackProcessing(context.Background(), "payment.order.created", "evt_1")
	if appCtx == nil || end == nil {
		t.Fatal("TrackProcessing returned nils; the app span must bracket the handler")
	}
	end()
	tel.RecordReceived("payment.order.created")
	tel.RecordUnknownEventType()
	tel.RecordInvalidSignature()
	tel.RecordBodyError(observability.ReasonUnreadable)
	tel.RecordEnvelopeRejection("data_source")
	tel.RecordEnvelopeAdvisory(observability.AdvisoryNotificationID)
	tel.RecordPublish("payment.order.created", observability.PublishSuccess, 12*time.Millisecond)
	slog.Info("the tee must carry this record to OTLP and stdout")

	drain, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := tel.Shutdown(drain); err != nil {
		t.Fatalf("Shutdown: %v", err)
	}
	for _, path := range []string{"/v1/traces", "/v1/metrics", "/v1/logs"} {
		if receiver.hits(path) == 0 {
			t.Errorf("the receiver never saw %s; the signal must have flushed at shutdown", path)
		}
	}

	attrs := resourceAttributes(t, receiver.payloads("/v1/traces"))
	for key, want := range map[string]string{
		"service.name":                "payment-webhook-test",
		"service.version":             "1.2.3",
		"deployment.environment":      "prod",
		"deployment.environment.name": "prod",
	} {
		if attrs[key] != want {
			t.Errorf("resource %s = %q, want %q", key, attrs[key], want)
		}
	}
}

func TestWiredBootFallsBackToTheDevVersion(t *testing.T) {
	receiver := newOTLPReceiver(t)
	cfg := resolvePlane(t, map[string]string{
		"OTEL_EXPORTER_OTLP_ENDPOINT": receiver.endpoint,
		"NEW_RELIC_LICENSE_KEY":       "unit-test-license-key-16",
	})
	tel, err := observability.Boot(cfg, "dev")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = tel.Shutdown(context.Background()) })

	devCtx, end := tel.TrackProcessing(context.Background(), "payment.order.created", "evt_dev")
	if devCtx == nil {
		t.Fatal("TrackProcessing returned nil context")
	}
	end()
	drain, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := tel.Shutdown(drain); err != nil {
		t.Fatalf("Shutdown: %v", err)
	}
	attrs := resourceAttributes(t, receiver.payloads("/v1/traces"))
	if attrs["service.name"] != "payment-webhook" {
		t.Errorf("resource service.name = %q, want the payment-webhook default composed through Resolve", attrs["service.name"])
	}
	if attrs["service.version"] != "dev" {
		t.Errorf("resource service.version = %q, want the dev fallback on the blank OTEL_SERVICE_VERSION", attrs["service.version"])
	}
}

// resourceAttributes unpicks the first resource payload the traces signal
// carried; exporters may wrap the protobuf in gzip.
func resourceAttributes(t *testing.T, payloads [][]byte) map[string]string {
	t.Helper()
	for _, payload := range payloads {
		raw := payload
		if gunzip, err := gzip.NewReader(bytes.NewReader(raw)); err == nil {
			decompressed, err := io.ReadAll(gunzip)
			_ = gunzip.Close()
			if err != nil {
				t.Fatalf("unwrapping the gzipped trace payload: %v", err)
			}
			raw = decompressed
		}
		export := &tracev1.ExportTraceServiceRequest{}
		if proto.Unmarshal(raw, export) != nil {
			continue
		}
		for _, spans := range export.ResourceSpans {
			if spans.Resource == nil {
				continue
			}
			attrs := map[string]string{}
			for _, attr := range spans.Resource.Attributes {
				attrs[attr.Key] = stringOf(attr.Value)
			}
			return attrs
		}
	}
	t.Fatal("no decodable resource payload; the receiver collected none")
	return nil
}

func stringOf(value *commonv1.AnyValue) string {
	if typed, ok := value.Value.(*commonv1.AnyValue_StringValue); ok {
		return typed.StringValue
	}
	return ""
}
