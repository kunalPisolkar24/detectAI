package observability_test

import (
	"bytes"
	"compress/gzip"
	"context"
	"io"
	"testing"
	"time"

	metricv1 "go.opentelemetry.io/proto/otlp/collector/metrics/v1"
	tracev1 "go.opentelemetry.io/proto/otlp/collector/trace/v1"
	commonv1 "go.opentelemetry.io/proto/otlp/common/v1"
	otlptrace "go.opentelemetry.io/proto/otlp/trace/v1"
	"google.golang.org/protobuf/proto"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/observability"
)

// metricPoint is one exported data point: its attributes and its counter value.
type metricPoint struct {
	attributes map[string]string
	value      int64
}

// metricPoints collects every exported data point by metric name.
func metricPoints(t *testing.T, payloads [][]byte) map[string][]metricPoint {
	t.Helper()
	points := map[string][]metricPoint{}
	for _, raw := range decodeAll(t, payloads) {
		export := &metricv1.ExportMetricsServiceRequest{}
		if proto.Unmarshal(raw, export) != nil {
			continue
		}
		for _, resource := range export.ResourceMetrics {
			for _, scope := range resource.ScopeMetrics {
				for _, metric := range scope.Metrics {
					if sum := metric.GetSum(); sum != nil {
						for _, point := range sum.DataPoints {
							points[metric.Name] = append(points[metric.Name], metricPoint{
								attributes: attributesOf(point.Attributes),
								value:      point.GetAsInt(),
							})
						}
					}
				}
			}
		}
	}
	return points
}

// metricNames lists every exported metric, histogram or counter.
func metricNames(t *testing.T, payloads [][]byte) map[string]bool {
	t.Helper()
	names := map[string]bool{}
	for _, raw := range decodeAll(t, payloads) {
		export := &metricv1.ExportMetricsServiceRequest{}
		if proto.Unmarshal(raw, export) != nil {
			continue
		}
		for _, resource := range export.ResourceMetrics {
			for _, scope := range resource.ScopeMetrics {
				for _, metric := range scope.Metrics {
					names[metric.Name] = true
				}
			}
		}
	}
	return names
}

// spanRecord is one exported span: its name, its attributes, and its status.
type spanRecord struct {
	name       string
	attributes map[string]string
	statusCode otlptrace.Status_StatusCode
}

func exportedSpans(t *testing.T, payloads [][]byte) []spanRecord {
	t.Helper()
	var spans []spanRecord
	for _, raw := range decodeAll(t, payloads) {
		export := &tracev1.ExportTraceServiceRequest{}
		if proto.Unmarshal(raw, export) != nil {
			continue
		}
		for _, resource := range export.ResourceSpans {
			for _, scope := range resource.ScopeSpans {
				for _, span := range scope.Spans {
					spans = append(spans, spanRecord{
						name:       span.Name,
						attributes: attributesOf(span.Attributes),
						statusCode: span.Status.GetCode(),
					})
				}
			}
		}
	}
	return spans
}

// decodeAll unwraps the gzipped payloads the exporters produce.
func decodeAll(t *testing.T, payloads [][]byte) [][]byte {
	t.Helper()
	var decoded [][]byte
	for _, payload := range payloads {
		raw := payload
		if gunzip, err := gzip.NewReader(bytes.NewReader(raw)); err == nil {
			decompressed, err := io.ReadAll(gunzip)
			_ = gunzip.Close()
			if err != nil {
				t.Fatalf("unwrapping the gzipped payload: %v", err)
			}
			raw = decompressed
		}
		decoded = append(decoded, raw)
	}
	return decoded
}

func attributesOf(attributes []*commonv1.KeyValue) map[string]string {
	out := map[string]string{}
	for _, attribute := range attributes {
		out[attribute.Key] = stringOf(attribute.Value)
	}
	return out
}

func TestTheWiredServiceExportsTheFrozenInstruments(t *testing.T) {
	receiver := newOTLPReceiver(t)
	tel, err := observability.Boot(wiredConfig(receiver.endpoint), "prod")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = tel.Shutdown(context.Background()) })

	tel.RecordRPC("/chats.v1.ChatService/GetChat", observability.RPCStatusOK, 12*time.Millisecond)
	tel.RecordRPC("/chats.v1.ChatService/DeleteChat", observability.RPCStatus("not_found"), 4*time.Millisecond)
	tel.RecordCacheOp(observability.CacheOperationChat, observability.CacheHit, time.Millisecond)
	tel.RecordDatastoreOp(observability.DatastoreOperationChat, observability.DatastoreNotFound, 3*time.Millisecond)
	tel.RecordRateLimitRefusal("create")
	tel.RecordValidationRejection("title")

	drain, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := tel.Shutdown(drain); err != nil {
		t.Fatalf("Shutdown: %v", err)
	}

	names := metricNames(t, receiver.payloads("/v1/metrics"))
	for _, want := range []string{
		observability.InstrumentRPCRequests,
		observability.InstrumentRPCErrors,
		observability.InstrumentRPCDuration,
		observability.InstrumentCacheOperations,
		observability.InstrumentCacheDuration,
		observability.InstrumentDatastoreOperations,
		observability.InstrumentDatastoreDuration,
		observability.InstrumentRateLimitRefusals,
		observability.InstrumentValidationRejections,
	} {
		if !names[want] {
			t.Errorf("the export carries no %s; the metric inventory is a contract", want)
		}
	}

	points := metricPoints(t, receiver.payloads("/v1/metrics"))
	assertPoint(t, points, observability.InstrumentRPCRequests,
		map[string]string{"procedure": "GetChat", "code": "ok"}, 1)
	assertPoint(t, points, observability.InstrumentRPCRequests,
		map[string]string{"procedure": "DeleteChat", "code": "not_found"}, 1)
	assertPoint(t, points, observability.InstrumentRPCErrors,
		map[string]string{"procedure": "DeleteChat", "code": "not_found"}, 1)
	assertPoint(t, points, observability.InstrumentCacheOperations,
		map[string]string{"operation": "chat", "result": "hit"}, 1)
	assertPoint(t, points, observability.InstrumentDatastoreOperations,
		map[string]string{"operation": "chat", "result": "not_found"}, 1)
	assertPoint(t, points, observability.InstrumentRateLimitRefusals,
		map[string]string{"scope": "create"}, 1)
	assertPoint(t, points, observability.InstrumentValidationRejections,
		map[string]string{"field": "title"}, 1)
}

func TestTheProcedureSpanCarriesTheRPCConventions(t *testing.T) {
	receiver := newOTLPReceiver(t)
	tel, err := observability.Boot(wiredConfig(receiver.endpoint), "prod")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = tel.Shutdown(context.Background()) })

	_, end := tel.TrackRPC(context.Background(), "/chats.v1.ChatService/GetChat")
	end(observability.RPCStatusOK)
	_, failed := tel.TrackRPC(context.Background(), "/chats.v1.ChatService/DeleteChat")
	failed(observability.RPCStatus("not_found"))

	drain, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := tel.Shutdown(drain); err != nil {
		t.Fatalf("Shutdown: %v", err)
	}

	spans := exportedSpans(t, receiver.payloads("/v1/traces"))
	var served, failedSpan *spanRecord
	for index := range spans {
		switch spans[index].name {
		case "chats.v1.ChatService/GetChat":
			served = &spans[index]
		case "chats.v1.ChatService/DeleteChat":
			failedSpan = &spans[index]
		}
	}
	if served == nil {
		t.Fatal("the export carries no GetChat span")
	}
	for key, want := range map[string]string{
		"rpc.system":  "connect_rpc",
		"rpc.service": "chats.v1.ChatService",
		"rpc.method":  "GetChat",
	} {
		if served.attributes[key] != want {
			t.Errorf("span %s = %q, want %q", key, served.attributes[key], want)
		}
	}
	if failedSpan == nil {
		t.Fatal("the export carries no DeleteChat span")
	}
	if failedSpan.attributes["rpc.connect_rpc.error_code"] != "not_found" {
		t.Errorf("the failed span carries error code %q, want not_found",
			failedSpan.attributes["rpc.connect_rpc.error_code"])
	}
	if failedSpan.statusCode != otlptrace.Status_STATUS_CODE_ERROR {
		t.Errorf("the failed span status = %v, want ERROR", failedSpan.statusCode)
	}
}

// assertPoint checks that one exported data point carries the attributes and the value.
func assertPoint(t *testing.T, points map[string][]metricPoint, name string, attributes map[string]string, value int64) {
	t.Helper()
	for _, point := range points[name] {
		match := true
		for key, want := range attributes {
			if point.attributes[key] != want {
				match = false
				break
			}
		}
		if match && point.value == value {
			return
		}
	}
	t.Errorf("%s carries no point with %v at %d; the exported points are %v", name, attributes, value, points[name])
}
