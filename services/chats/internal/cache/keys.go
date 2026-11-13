package cache

import (
	"strconv"
	"time"
)

// prefix scopes every chats key on the shared instance; the namespace keeps
// one instance safe for many services.
const prefix = "chats:"

// TTLs bound every cached entry, so a swept key is indistinguishable from an expired one.
const (
	ChatMetaTTL = 10 * time.Minute
	ChatHeadTTL = 10 * time.Minute
	ChatListTTL = 5 * time.Minute
)

// RateLimitWindow is the fixed window the burst counters run on; the window
// id is the epoch minute it opens at.
const RateLimitWindow = time.Minute

// RateLimitGrace outlives the window edge, so a counter never expires while
// its window still counts.
const RateLimitGrace = 2 * time.Minute

func ChatKey(chatID string) string {
	return prefix + "chat:" + chatID
}

func ChatHeadKey(chatID string) string {
	return prefix + "chat:" + chatID + ":head"
}

func OwnerChatsKey(ownerID string) string {
	return prefix + "user:" + ownerID + ":chats"
}

func RateLimitKey(ownerID, scope string, windowMinute int64) string {
	return prefix + "rate_limit:" + ownerID + ":" + scope + ":" + strconv.FormatInt(windowMinute, 10)
}
