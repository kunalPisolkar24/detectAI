package ports

type MetricsCollector interface {
	IncCacheHit()
	IncCacheMiss()
}
