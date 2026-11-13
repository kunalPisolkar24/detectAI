package observability_test

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/hex"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	logsv1 "go.opentelemetry.io/proto/otlp/collector/logs/v1"
	tracev1 "go.opentelemetry.io/proto/otlp/collector/trace/v1"
	"google.golang.org/protobuf/proto"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/observability"
)

const (
	inboundTraceID = "4bf92f3577b34da6a3ce929d0e0e4736"
	inboundSpanID  = "00f067aa0ba902b7"
)

func TestTheWiredBootJoinsTheInboundTrace(t *testing.T) {
	receiver := newOTLPReceiver(t)
	tel, err := observability.Boot(wiredConfig(receiver.endpoint), "prod")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = tel.Shutdown(context.Background()) })

	engine := gin.New()
	observability.Wire(tel, engine)
	engine.GET("/v1/chat", func(c *gin.Context) { c.Status(http.StatusOK) })

	req := httptest.NewRequest(http.MethodGet, "/v1/chat", nil)
	req.Header.Set("traceparent", "00-"+inboundTraceID+"-"+inboundSpanID+"-01")
	engine.ServeHTTP(httptest.NewRecorder(), req)

	flush(t, tel)

	ids := spanTraceIDs(t, receiver.payloads("/v1/traces"))
	if len(ids) == 0 {
		t.Fatal("the receiver saw no span; the route must be traced")
	}
	if !contains(ids, inboundTraceID) {
		t.Errorf("no span joined the inbound trace %s; the exported trace ids were %v", inboundTraceID, ids)
	}
}

func TestTheLogRecordCarriesTheRequestTrace(t *testing.T) {
	receiver := newOTLPReceiver(t)
	tel, err := observability.Boot(wiredConfig(receiver.endpoint), "prod")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = tel.Shutdown(context.Background()) })

	engine := gin.New()
	observability.Wire(tel, engine)
	engine.GET("/v1/chat", func(c *gin.Context) {
		slog.InfoContext(c.Request.Context(), "the record must carry the request trace")
		c.Status(http.StatusOK)
	})

	req := httptest.NewRequest(http.MethodGet, "/v1/chat", nil)
	req.Header.Set("traceparent", "00-"+inboundTraceID+"-"+inboundSpanID+"-01")
	engine.ServeHTTP(httptest.NewRecorder(), req)

	flush(t, tel)

	ids := logTraceIDs(t, receiver.payloads("/v1/logs"))
	if len(ids) == 0 {
		t.Fatal("the receiver saw no log record; the tee must carry the slog record")
	}
	if !contains(ids, inboundTraceID) {
		t.Errorf("no log record carried the request trace %s; the exported trace ids were %v", inboundTraceID, ids)
	}
}

// The app owns its deployment labels; the environment may add labels but never
// relabel the ones the app sets. The SDK merges OTEL_RESOURCE_ATTRIBUTES under
// the resource the provider is given, so this pins that precedence.
func TestTheAppLabelsWinOverTheEnvironment(t *testing.T) {
	t.Setenv("OTEL_RESOURCE_ATTRIBUTES", "deployment.environment=loadtest,team=chats")

	receiver := newOTLPReceiver(t)
	tel, err := observability.Boot(wiredConfig(receiver.endpoint), "prod")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = tel.Shutdown(context.Background()) })

	engine := gin.New()
	observability.Wire(tel, engine)
	engine.GET("/v1/chat", func(c *gin.Context) { c.Status(http.StatusOK) })
	engine.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/v1/chat", nil))

	flush(t, tel)

	attrs := resourceAttributes(t, receiver.payloads("/v1/traces"))
	if attrs["deployment.environment"] != "prod" {
		t.Errorf("resource deployment.environment = %q, want the app's own prod; the environment must not relabel it",
			attrs["deployment.environment"])
	}
	if attrs["team"] != "chats" {
		t.Errorf("resource team = %q, want the environment's chats", attrs["team"])
	}
}

// flush drains the telemetry so the exporter has shipped every signal.
func flush(t *testing.T, tel observability.Telemetry) {
	t.Helper()
	drain, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := tel.Shutdown(drain); err != nil {
		t.Fatalf("Shutdown: %v", err)
	}
}

// spanTraceIDs reads the trace id of every exported span.
func spanTraceIDs(t *testing.T, payloads [][]byte) []string {
	t.Helper()
	var ids []string
	for _, payload := range payloads {
		export := &tracev1.ExportTraceServiceRequest{}
		if proto.Unmarshal(unwrapGzip(t, payload), export) != nil {
			continue
		}
		for _, resourceSpans := range export.ResourceSpans {
			for _, scopeSpans := range resourceSpans.ScopeSpans {
				for _, span := range scopeSpans.Spans {
					ids = append(ids, hex.EncodeToString(span.TraceId))
				}
			}
		}
	}
	return ids
}

// logTraceIDs reads the trace id of every exported log record.
func logTraceIDs(t *testing.T, payloads [][]byte) []string {
	t.Helper()
	var ids []string
	for _, payload := range payloads {
		export := &logsv1.ExportLogsServiceRequest{}
		if proto.Unmarshal(unwrapGzip(t, payload), export) != nil {
			continue
		}
		for _, resourceLogs := range export.ResourceLogs {
			for _, scopeLogs := range resourceLogs.ScopeLogs {
				for _, record := range scopeLogs.LogRecords {
					ids = append(ids, hex.EncodeToString(record.TraceId))
				}
			}
		}
	}
	return ids
}

// unwrapGzip returns the payload's plain bytes; the exporters compress what they send.
func unwrapGzip(t *testing.T, payload []byte) []byte {
	t.Helper()
	gunzip, err := gzip.NewReader(bytes.NewReader(payload))
	if err != nil {
		return payload
	}
	defer gunzip.Close()
	plain, err := io.ReadAll(gunzip)
	if err != nil {
		t.Fatalf("unwrapping the gzipped payload: %v", err)
	}
	return plain
}

func contains(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}
