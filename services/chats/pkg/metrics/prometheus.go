package metrics

import (
	"net/http"
	"sync"

	"github.com/kunalPisolkar24/detectAI/services/chats/pkg/logger"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"go.uber.org/zap"
)

var (
	MessagesIngested = prometheus.NewCounter(prometheus.CounterOpts{
		Name: "chat_messages_ingested_total",
		Help: "Total number of messages successfully ingested into MongoDB",
	})

	StreamLag = prometheus.NewGaugeVec(prometheus.GaugeOpts{
		Name: "chat_redis_stream_lag",
		Help: "Current lag of the Redis stream consumer group",
	}, []string{"partition"})

	CacheHits = prometheus.NewCounter(prometheus.CounterOpts{
		Name: "chat_cache_hits_total",
		Help: "Total number of cache hits",
	})

	CacheMisses = prometheus.NewCounter(prometheus.CounterOpts{
		Name: "chat_cache_misses_total",
		Help: "Total number of cache misses",
	})

	RequestLatency = prometheus.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "grpc_request_duration_seconds",
		Help:    "Time taken to process gRPC requests",
		Buckets: prometheus.DefBuckets,
	}, []string{"method", "status"})

	DLQMessages = prometheus.NewCounter(prometheus.CounterOpts{
		Name: "chat_dlq_messages_total",
		Help: "Total number of messages moved to the dead letter queue",
	})

	StreamErrors = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "chat_stream_errors_total",
		Help: "Total number of Redis stream errors",
	}, []string{"operation"})

	DatabaseErrors = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "chat_database_errors_total",
		Help: "Total number of database operation errors",
	}, []string{"operation"})

	initOnce sync.Once
)

type PrometheusMetrics struct{}

func NewPrometheusMetrics() *PrometheusMetrics {
	return &PrometheusMetrics{}
}

func (p *PrometheusMetrics) IncCacheHit() {
	CacheHits.Inc()
}

func (p *PrometheusMetrics) IncCacheMiss() {
	CacheMisses.Inc()
}

func (p *PrometheusMetrics) AddIngestedMessages(count float64) {
	MessagesIngested.Add(count)
}

func (p *PrometheusMetrics) SetStreamLag(partition string, lag float64) {
	StreamLag.WithLabelValues(partition).Set(lag)
}

func (p *PrometheusMetrics) IncDLQMessages(count float64) {
	DLQMessages.Add(count)
}

func (p *PrometheusMetrics) IncStreamErrors(operation string) {
	StreamErrors.WithLabelValues(operation).Inc()
}

func (p *PrometheusMetrics) IncDatabaseErrors(operation string) {
	DatabaseErrors.WithLabelValues(operation).Inc()
}

func Init() {
	initOnce.Do(func() {
		prometheus.MustRegister(
			MessagesIngested,
			StreamLag,
			CacheHits,
			CacheMisses,
			RequestLatency,
			DLQMessages,
			StreamErrors,
			DatabaseErrors,
		)
	})
}

func StartMetricsServer(port string) {
	mux := http.NewServeMux()
	mux.Handle("/metrics", promhttp.Handler())
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})
	go func() {
		if err := http.ListenAndServe(port, mux); err != nil && err != http.ErrServerClosed {
			if logger.Log != nil {
				logger.Log.Error("Metrics server failed", zap.Error(err))
			}
		}
	}()
}
