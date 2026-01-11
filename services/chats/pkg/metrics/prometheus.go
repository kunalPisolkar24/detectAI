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
)

func Init() {
	prometheus.MustRegister(MessagesIngested)
	prometheus.MustRegister(StreamLag)
}

func StartMetricsServer(port string) {
	http.Handle("/metrics", promhttp.Handler())
	go func() {
		if err := http.ListenAndServe(port, nil); err != nil {
			logger.Log.Error("Metrics server failed", zap.Error(err))
		}
	}()
}
