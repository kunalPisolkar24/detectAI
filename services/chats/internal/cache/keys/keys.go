package keys

import (
	"time"
)

const prefix = "chats:"

const (
	lockSegment   = "lock:"
	flightSegment = "flight:"
	missSegment   = "nf:"
)

const (
	ChatMetaTTL = 10 * time.Minute
	ChatHeadTTL = 10 * time.Minute
	ChatListTTL = 5 * time.Minute
	NegativeTTL = time.Minute
)

func ChatKey(chatID string) string {
	return prefix + "chat:" + chatID
}

func ChatHeadKey(chatID string) string {
	return prefix + "chat:" + chatID + ":head"
}

func OwnerChatsKey(ownerID string) string {
	return prefix + "user:" + ownerID + ":chats"
}

func RateLimitKey(ownerID, scope string) string {
	return prefix + "rate_limit:" + ownerID + ":" + scope
}

func LockKey(resource string) string {
	return prefix + lockSegment + resource
}

func FlightKey(kind, resource string) string {
	return prefix + flightSegment + kind + ":" + resource
}

func MissKey(resource string) string {
	return prefix + missSegment + resource
}

func ChatResource(chatID string) string {
	return "chat:" + chatID
}

func ChatHeadResource(chatID string) string {
	return "chat:" + chatID + ":head"
}

func OwnerChatsResource(ownerID string) string {
	return "user:" + ownerID + ":chats"
}

// ChatLookupResource is scoped by owner because ownership is part of the
// lookup: a foreign owner's not-found must never hide a chat from its owner.
func ChatLookupResource(ownerID, chatID string) string {
	return "user:" + ownerID + ":chat:" + chatID
}
