package metrics

import (
	"net/http"

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
)

func Init() {
	prometheus.MustRegister(MessagesIngested, StreamLag, CacheHits, CacheMisses, RequestLatency)
}

func StartMetricsServer(port string) {
	http.Handle("/metrics", promhttp.Handler())
	go func() {
		if err := http.ListenAndServe(port, nil); err != nil {
			logger.Log.Error("Metrics server failed", zap.Error(err))
		}
	}()
}