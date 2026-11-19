// Package observability_test drives the telemetry boot against a receiver inside
// the test process, so the units stay network-free.
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

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/observability"
)

// otlpReceiver swallows OTLP POSTs inside the test process.
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

// wiredConfig points the boot at the receiver with a throwaway license key.
func wiredConfig(endpoint string) observability.Config {
	return observability.Config{
		Endpoint:       endpoint,
		LicenseKey:     "unit-test-license-key-16",
		ServiceName:    "chats-test",
		ServiceVersion: "1.2.3",
		SampleRatio:    1.0,
	}
}

func TestBootWithoutEndpointBuildsTheNullBoot(t *testing.T) {
	tel, err := observability.Boot(observability.Config{}, "dev")
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
	tel, err := observability.Boot(wiredConfig(receiver.endpoint), "prod")
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

	ctx, end := tel.TrackRPC(context.Background(), "/chats.v1.ChatService/GetChat")
	if ctx == nil || end == nil {
		t.Fatal("TrackRPC returned nils; the app span must bracket the handler")
	}
	tel.RecordRPC("/chats.v1.ChatService/GetChat", observability.RPCStatusOK, 12*time.Millisecond)
	tel.RecordCacheOp(observability.CacheOperationChat, observability.CacheHit, time.Millisecond)
	tel.RecordDatastoreOp(observability.DatastoreOperationChat, observability.DatastoreNotFound, 3*time.Millisecond)
	tel.RecordRateLimitRefusal("create")
	tel.RecordValidationRejection("title")
	end(observability.RPCStatusOK)
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
		"service.name":                "chats-test",
		"service.version":             "1.2.3",
		"deployment.environment":      "prod",
		"deployment.environment.name": "prod",
	} {
		if attrs[key] != want {
			t.Errorf("resource %s = %q, want %q", key, attrs[key], want)
		}
	}
}

func TestWiredBootFallsBackToTheServiceDefaults(t *testing.T) {
	receiver := newOTLPReceiver(t)
	tel, err := observability.Boot(observability.Config{
		Endpoint:   receiver.endpoint,
		LicenseKey: "unit-test-license-key-16",
	}, "dev")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = tel.Shutdown(context.Background()) })

	ctx, end := tel.TrackRPC(context.Background(), "/chats.v1.ChatService/GetChat")
	if ctx == nil {
		t.Fatal("TrackRPC returned nil context")
	}
	end(observability.RPCStatusOK)
	drain, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := tel.Shutdown(drain); err != nil {
		t.Fatalf("Shutdown: %v", err)
	}
	attrs := resourceAttributes(t, receiver.payloads("/v1/traces"))
	if attrs["service.name"] != "chats" {
		t.Errorf("resource service.name = %q, want the chats default", attrs["service.name"])
	}
	if attrs["service.version"] != "dev" {
		t.Errorf("resource service.version = %q, want the dev fallback", attrs["service.version"])
	}
}

// resourceAttributes reads the first decodable resource payload; exporters may gzip the protobuf.
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
