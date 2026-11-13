package observability

import "strings"

// New Relic's OTLP shaping: the ingest license key rides the api-key header,
// never a user key.
const (
	tracesSignal  = "/v1/traces"
	metricsSignal = "/v1/metrics"
	logsSignal    = "/v1/logs"
)

// NewRelicKeyHeader is the header New Relic's OTLP endpoint authenticates with.
const NewRelicKeyHeader = "api-key"

func signalURL(endpoint, signal string) string {
	return strings.TrimSuffix(endpoint, "/") + signal
}

func authHeaders(licenseKey string) map[string]string {
	return map[string]string{NewRelicKeyHeader: licenseKey}
}
