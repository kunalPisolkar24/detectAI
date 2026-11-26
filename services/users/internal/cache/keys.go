package cache

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"time"
)

const (
	UserTTL     = time.Hour
	EmailTTL    = time.Hour
	NegativeTTL = time.Minute

	keyPrefix   = "users:"
	lockSegment = "lock:"
	missSegment = "nf:"
	hashLength  = 16
)

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

func emailHash(email string) string {
	return shortHash(strings.ToLower(strings.TrimSpace(email)))
}

func shortHash(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:hashLength/2])
}
