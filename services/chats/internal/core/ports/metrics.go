package ports

type MetricsCollector interface {
	IncCacheHit()
	IncCacheMiss()
	AddIngestedMessages(count float64)
	SetStreamLag(partition string, lag float64)
}
