package monitoring

import (
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/collectors"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

type Monitor struct {
	handler  http.Handler
	requests *prometheus.CounterVec
	errors   *prometheus.CounterVec
	duration *prometheus.HistogramVec

	// Domain Metrics
	eventPublished   *prometheus.CounterVec
	invalidSignature prometheus.Counter

	webhooksReceived     *prometheus.CounterVec
	webhooksUnknownType  prometheus.Counter
	internalUnauthorized prometheus.Counter
	webhookBodyErrors    *prometheus.CounterVec
	signatureValidation  prometheus.Histogram
	buildInfo            *prometheus.GaugeVec

	// Infrastructure Metrics
	rabbitmqStatus     prometheus.Gauge
	rabbitmqPublishDur prometheus.Histogram
	rabbitmqReconnects prometheus.Counter
}

func New(serviceName string) *Monitor {
	registry := prometheus.NewRegistry()
	registerer := prometheus.WrapRegistererWith(prometheus.Labels{"service": serviceName}, registry)

	requests := prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "http_requests_total",
			Help: "Total number of HTTP requests",
		},
		[]string{"method", "route", "status_code"},
	)
	errors := prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "http_request_errors_total",
			Help: "Total number of HTTP requests resulting in errors",
		},
		[]string{"method", "route", "status_code"},
	)
	duration := prometheus.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:    "http_request_duration_seconds",
			Help:    "Duration of HTTP requests in seconds",
			Buckets: []float64{0.01, 0.05, 0.1, 0.3, 0.5, 1, 2.5, 5, 10},
		},
		[]string{"method", "route", "status_code"},
	)

	eventPublished := prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "payment_events_published_total",
			Help: "Total number of payment events published to queue",
		},
		[]string{"event_type", "status"},
	)

	invalidSignature := prometheus.NewCounter(
		prometheus.CounterOpts{
			Name: "payment_webhook_signatures_invalid_total",
			Help: "Total number of payment webhook signatures that failed validation",
		},
	)

	webhooksReceived := prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "payment_webhooks_received_total",
			Help: "Total number of payment webhooks received, counted before signature validation",
		},
		[]string{"event_type"},
	)

	webhooksUnknownType := prometheus.NewCounter(
		prometheus.CounterOpts{
			Name: "payment_webhooks_unknown_event_type_total",
			Help: "Total number of payment webhooks with a missing event_type or alert_name field",
		},
	)

	internalUnauthorized := prometheus.NewCounter(
		prometheus.CounterOpts{
			Name: "payment_internal_events_unauthorized_total",
			Help: "Total number of internal event requests rejected due to a missing or wrong X-Internal-Key",
		},
	)

	webhookBodyErrors := prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "payment_webhook_body_errors_total",
			Help: "Total number of webhook request bodies that could not be read, by reason",
		},
		[]string{"reason"},
	)

	signatureValidation := prometheus.NewHistogram(
		prometheus.HistogramOpts{
			Name:    "payment_signature_validation_duration_seconds",
			Help:    "Duration of webhook HMAC signature validation in seconds",
			Buckets: []float64{0.0001, 0.00025, 0.0005, 0.001, 0.0025, 0.005, 0.01, 0.05, 0.1},
		},
	)

	buildInfo := prometheus.NewGaugeVec(
		prometheus.GaugeOpts{
			Name: "gateway_build_info",
			Help: "Build information for the payment gateway, always set to 1",
		},
		[]string{"version", "commit"},
	)

	rabbitmqStatus := prometheus.NewGauge(
		prometheus.GaugeOpts{
			Name: "rabbitmq_connection_status",
			Help: "Current status of RabbitMQ connection (1 = connected, 0 = disconnected)",
		},
	)

	rabbitmqPublishDur := prometheus.NewHistogram(
		prometheus.HistogramOpts{
			Name:    "rabbitmq_publish_duration_seconds",
			Help:    "Time taken to publish a message and receive confirmation",
			Buckets: []float64{0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5},
		},
	)

	rabbitmqReconnects := prometheus.NewCounter(
		prometheus.CounterOpts{
			Name: "rabbitmq_reconnections_total",
			Help: "Total number of times the service has reconnected to RabbitMQ",
		},
	)

	registerer.MustRegister(
		requests,
		errors,
		duration,
		eventPublished,
		invalidSignature,
		webhooksReceived,
		webhooksUnknownType,
		internalUnauthorized,
		webhookBodyErrors,
		signatureValidation,
		buildInfo,
		rabbitmqStatus,
		rabbitmqPublishDur,
		rabbitmqReconnects,
		collectors.NewGoCollector(),
		collectors.NewProcessCollector(collectors.ProcessCollectorOpts{}),
	)

	return &Monitor{
		handler:              promhttp.HandlerFor(registry, promhttp.HandlerOpts{}),
		requests:             requests,
		errors:               errors,
		duration:             duration,
		eventPublished:       eventPublished,
		invalidSignature:     invalidSignature,
		webhooksReceived:     webhooksReceived,
		webhooksUnknownType:  webhooksUnknownType,
		internalUnauthorized: internalUnauthorized,
		webhookBodyErrors:    webhookBodyErrors,
		signatureValidation:  signatureValidation,
		buildInfo:            buildInfo,
		rabbitmqStatus:       rabbitmqStatus,
		rabbitmqPublishDur:   rabbitmqPublishDur,
		rabbitmqReconnects:   rabbitmqReconnects,
	}
}

func (m *Monitor) Handler() http.Handler {
	return m.handler
}

func (m *Monitor) Middleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.Request.URL.Path == "/metrics" {
			c.Next()
			return
		}

		start := time.Now()
		c.Next()

		route := c.FullPath()
		if route == "" {
			route = c.Request.URL.Path
		}

		statusCode := strconv.Itoa(c.Writer.Status())
		m.requests.WithLabelValues(c.Request.Method, route, statusCode).Inc()
		m.duration.WithLabelValues(c.Request.Method, route, statusCode).Observe(time.Since(start).Seconds())

		if c.Writer.Status() >= http.StatusBadRequest {
			m.errors.WithLabelValues(c.Request.Method, route, statusCode).Inc()
		}
	}
}

// MetricsRecorder implementation

func (m *Monitor) RecordPublish(eventType, status string) {
	m.eventPublished.WithLabelValues(eventType, status).Inc()
}

func (m *Monitor) RecordInvalidSignature() {
	m.invalidSignature.Inc()
}

func (m *Monitor) RecordWebhookReceived(eventType string) {
	m.webhooksReceived.WithLabelValues(eventType).Inc()
}

func (m *Monitor) RecordWebhookUnknownEventType() {
	m.webhooksUnknownType.Inc()
}

func (m *Monitor) RecordInternalEventUnauthorized() {
	m.internalUnauthorized.Inc()
}

func (m *Monitor) RecordWebhookBodyError(reason string) {
	m.webhookBodyErrors.WithLabelValues(reason).Inc()
}

func (m *Monitor) RecordSignatureValidationDuration(seconds float64) {
	m.signatureValidation.Observe(seconds)
}

func (m *Monitor) SetBuildInfo(version, commit string) {
	m.buildInfo.WithLabelValues(version, commit).Set(1)
}

func (m *Monitor) SetRabbitMQStatus(connected bool) {
	if connected {
		m.rabbitmqStatus.Set(1)
	} else {
		m.rabbitmqStatus.Set(0)
	}
}

func (m *Monitor) RecordRabbitMQPublishDuration(duration float64) {
	m.rabbitmqPublishDur.Observe(duration)
}

func (m *Monitor) RecordRabbitMQReconnection() {
	m.rabbitmqReconnects.Inc()
}
