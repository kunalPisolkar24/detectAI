package cache

import (
	"crypto/sha256"
	"encoding/hex"
	"strconv"
	"strings"
	"time"
)

const (
	UserTTL     = time.Hour
	EmailTTL    = time.Hour
	NegativeTTL = time.Minute

	keyPrefix        = "users:"
	lockSegment      = "lock:"
	missSegment      = "nf:"
	flightSegment    = "flight:"
	rateLimitSegment = "rate_limit:"
	hashLength       = 16
)

// RateLimitWindow is the fixed window the burst counters run on; the window
// id is the epoch minute it opens at.
const RateLimitWindow = time.Minute

// RateLimitGrace outlives the window edge, so a counter never expires while
// its window still counts.
const RateLimitGrace = 2 * time.Minute

func DataKey(resource string) string {
	return keyPrefix + resource
}

func UserResource(id string) string {
	return "user:" + id
}

func EmailResource(email string) string {
	return "email:" + emailHash(email)
}

func LockKey(resource string) string {
	return keyPrefix + lockSegment + resource
}

func MissKey(resource string) string {
	return keyPrefix + missSegment + resource
}

func FlightKey(kind, resource string) string {
	return keyPrefix + flightSegment + kind + ":" + resource
}

func RateLimitKey(identity, scope string, windowMinute int64) string {
	return keyPrefix + rateLimitSegment + identity + ":" + scope + ":" + strconv.FormatInt(windowMinute, 10)
}

func emailHash(email string) string {
	return shortHash(strings.ToLower(strings.TrimSpace(email)))
}

func shortHash(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:hashLength/2])
}
