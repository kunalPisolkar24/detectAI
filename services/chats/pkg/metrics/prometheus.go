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

	MessagesPublished = prometheus.NewCounter(prometheus.CounterOpts{
		Name: "chat_messages_published_total",
		Help: "Total number of messages successfully published to Redis stream",
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

	SyncFallback = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "chat_sync_fallback_total",
		Help: "Total number of sync Mongo fallback writes when Redis stream was unavailable",
	}, []string{"reason"})

	RedisDegraded = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "chat_redis_degraded",
		Help: "1 when Redis is degraded/unavailable, 0 when healthy",
	})

	GRPCRequests = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "chat_grpc_requests_total",
		Help: "Total number of gRPC requests handled by method and status",
	}, []string{"method", "status"})

	GRPCErrors = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "chat_grpc_errors_total",
		Help: "Total number of failed gRPC requests by method and code",
	}, []string{"method", "code"})

	WorkerConsumed = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "chat_worker_consumed_total",
		Help: "Total number of stream messages consumed by the worker by partition",
	}, []string{"partition"})

	StreamPending = prometheus.NewGaugeVec(prometheus.GaugeOpts{
		Name: "chat_stream_pending",
		Help: "Current pending (unacked) entries of the Redis stream consumer group",
	}, []string{"stream"})

	MongoOpDuration = prometheus.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "chat_mongo_op_duration_seconds",
		Help:    "Time taken for MongoDB operations by operation",
		Buckets: []float64{.001, .005, .01, .025, .05, .1, .25, .5, 1, 2.5, 5},
	}, []string{"operation"})

	RedisOpDuration = prometheus.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "chat_redis_op_duration_seconds",
		Help:    "Time taken for Redis operations by operation",
		Buckets: []float64{.001, .005, .01, .025, .05, .1, .25, .5, 1, 2.5, 5},
	}, []string{"operation"})

	CacheOpDuration = prometheus.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "chat_cache_op_duration_seconds",
		Help:    "Time taken for cache operations by operation and result",
		Buckets: []float64{.001, .005, .01, .025, .05, .1, .25, .5, 1},
	}, []string{"operation", "result"})

	WorkerBatchDuration = prometheus.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "chat_worker_batch_duration_seconds",
		Help:    "Time taken by the worker to process one batch by stage",
		Buckets: []float64{.005, .01, .025, .05, .1, .25, .5, 1, 2.5, 5, 10},
	}, []string{"stage"})

	MessageBytes = prometheus.NewHistogram(prometheus.HistogramOpts{
		Name:    "chat_message_bytes",
		Help:    "Size of ingested message content in bytes",
		Buckets: []float64{64, 256, 1024, 4096, 16384, 65536, 262144},
	})

	BatchSize = prometheus.NewHistogram(prometheus.HistogramOpts{
		Name:    "chat_batch_size",
		Help:    "Number of messages per worker batch",
		Buckets: []float64{1, 5, 10, 25, 50, 100, 250},
	})

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

func (p *PrometheusMetrics) IncPublishedMessages(count float64) {
	MessagesPublished.Add(count)
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

func (p *PrometheusMetrics) IncSyncFallback(reason string) {
	SyncFallback.WithLabelValues(reason).Inc()
}

func (p *PrometheusMetrics) SetRedisDegraded(v float64) {
	RedisDegraded.Set(v)
}

func Init() {
	initOnce.Do(func() {
		prometheus.MustRegister(
			MessagesIngested,
			MessagesPublished,
			StreamLag,
			CacheHits,
			CacheMisses,
			RequestLatency,
			DLQMessages,
			StreamErrors,
			DatabaseErrors,
			SyncFallback,
			RedisDegraded,
			GRPCRequests,
			GRPCErrors,
			WorkerConsumed,
			StreamPending,
			MongoOpDuration,
			RedisOpDuration,
			CacheOpDuration,
			WorkerBatchDuration,
			MessageBytes,
			BatchSize,
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
