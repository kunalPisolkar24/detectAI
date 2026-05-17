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

	// Infrastructure Metrics
	rabbitmqStatus      prometheus.Gauge
	rabbitmqPublishDur  prometheus.Histogram
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
		rabbitmqStatus,
		rabbitmqPublishDur,
		rabbitmqReconnects,
		collectors.NewGoCollector(),
		collectors.NewProcessCollector(collectors.ProcessCollectorOpts{}),
	)

	return &Monitor{
		handler:            promhttp.HandlerFor(registry, promhttp.HandlerOpts{}),
		requests:           requests,
		errors:             errors,
		duration:           duration,
		eventPublished:     eventPublished,
		invalidSignature:   invalidSignature,
		rabbitmqStatus:     rabbitmqStatus,
		rabbitmqPublishDur: rabbitmqPublishDur,
		rabbitmqReconnects: rabbitmqReconnects,
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
