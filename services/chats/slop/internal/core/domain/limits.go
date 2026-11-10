package domain

import "time"

const (
	DefaultPageSize       = 20
	MaxPageSize           = 100
	DefaultUserChatsLimit = 50
	MaxUserChatsLimit     = 100
	MaxTitleLen           = 200
	MaxContentLen         = 20000
	MaxRoleLen            = 20
	MaxCacheSize          = 100
	BucketCapacity        = 50
	BucketWindow          = 24 * time.Hour
	MaxBucketsFetch       = 500
	MaxOffsetGuard        = 1_000_000
	StreamMaxLen          = 100000
	StreamApproxTrim      = true
	DLQTTL                = 7 * 24 * time.Hour
	RecoveryIdle          = 60 * time.Second
	RecoveryInterval      = 30 * time.Second
	LagReportInterval     = 5 * time.Second
	ReadBlockDuration     = 2 * time.Second
	HealthCheckInterval   = 10 * time.Second
	HealthPingTimeout     = 3 * time.Second
	CachePopulateTimeout  = 5 * time.Second
	RequestTimeout        = 10 * time.Second
	SlowRequestThreshold  = 500 * time.Millisecond
)

var ValidRoles = map[string]struct{}{
	"user":      {},
	"assistant": {},
	"system":    {},
	"tool":      {},
}
