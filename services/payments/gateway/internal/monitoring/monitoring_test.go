package monitoring

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/prometheus/client_golang/prometheus/testutil"
	"github.com/stretchr/testify/assert"
)

func TestRecordWebhookReceived(t *testing.T) {
	m := New("payment-gateway")

	m.RecordWebhookReceived("payment.succeeded")
	m.RecordWebhookReceived("payment.succeeded")
	m.RecordWebhookReceived("payment.failed")

	assert.Equal(t, 2.0, testutil.ToFloat64(m.webhooksReceived.WithLabelValues("payment.succeeded")))
	assert.Equal(t, 1.0, testutil.ToFloat64(m.webhooksReceived.WithLabelValues("payment.failed")))
}

func TestRecordWebhookUnknownEventType(t *testing.T) {
	m := New("payment-gateway")

	m.RecordWebhookUnknownEventType()

	assert.Equal(t, 1.0, testutil.ToFloat64(m.webhooksUnknownType))
}

func TestRecordInternalEventUnauthorized(t *testing.T) {
	m := New("payment-gateway")

	m.RecordInternalEventUnauthorized()
	m.RecordInternalEventUnauthorized()

	assert.Equal(t, 2.0, testutil.ToFloat64(m.internalUnauthorized))
}

func TestRecordWebhookBodyError(t *testing.T) {
	m := New("payment-gateway")

	m.RecordWebhookBodyError("too_large")
	m.RecordWebhookBodyError("unreadable")

	assert.Equal(t, 1.0, testutil.ToFloat64(m.webhookBodyErrors.WithLabelValues("too_large")))
	assert.Equal(t, 1.0, testutil.ToFloat64(m.webhookBodyErrors.WithLabelValues("unreadable")))
}

func TestRecordSignatureValidationDuration(t *testing.T) {
	m := New("payment-gateway")

	m.RecordSignatureValidationDuration(0.5)

	assert.Equal(t, 1, testutil.CollectAndCount(m.signatureValidation))
}

func TestSetBuildInfo(t *testing.T) {
	m := New("payment-gateway")

	m.SetBuildInfo("1.2.3", "abc123")

	assert.Equal(t, 1.0, testutil.ToFloat64(m.buildInfo.WithLabelValues("1.2.3", "abc123")))
}

func TestMetricsEndpointExposesNewFamilies(t *testing.T) {
	m := New("payment-gateway")

	m.RecordWebhookReceived("payment.succeeded")
	m.RecordWebhookUnknownEventType()
	m.RecordInternalEventUnauthorized()
	m.RecordWebhookBodyError("too_large")
	m.RecordSignatureValidationDuration(0.001)
	m.SetBuildInfo("dev", "unknown")

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/metrics", nil)
	m.Handler().ServeHTTP(w, req)

	for _, family := range []string{
		"payment_webhooks_received_total",
		"payment_webhooks_unknown_event_type_total",
		"payment_internal_events_unauthorized_total",
		"payment_webhook_body_errors_total",
		"payment_signature_validation_duration_seconds",
		"gateway_build_info",
	} {
		assert.Contains(t, w.Body.String(), family)
	}
}
