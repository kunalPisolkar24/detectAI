package ports

type MetricsCollector interface {
	IncCacheHit()
	IncCacheMiss()
	AddIngestedMessages(count float64)
	IncPublishedMessages(count float64)
	SetStreamLag(partition string, lag float64)
	IncDLQMessages(count float64)
	IncStreamErrors(operation string)
	IncDatabaseErrors(operation string)
}
