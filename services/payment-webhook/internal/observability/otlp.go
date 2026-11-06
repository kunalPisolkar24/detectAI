package observability

import "strings"

// The pure New Relic OTLP shaping, zero SDK: one signal path off the base
// endpoint and the api-key header carrying the ingest license key — never a
// user key. Region-prefixed endpoints ride the endpoint value itself.
const (
	tracesSignal  = "/v1/traces"
	metricsSignal = "/v1/metrics"
	logsSignal    = "/v1/logs"
)

// signalURL joins the base endpoint with one OTLP signal path.
func signalURL(endpoint, signal string) string {
	return strings.TrimSuffix(endpoint, "/") + signal
}

// NewRelicKeyHeader is the HTTP header New Relic's OTLP endpoint authenticates
// with — the ingest license key's home.
const NewRelicKeyHeader = "api-key"

// authHeaders shapes the pool every exporter shares.
func authHeaders(licenseKey string) map[string]string {
	return map[string]string{NewRelicKeyHeader: licenseKey}
}
