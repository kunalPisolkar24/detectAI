package cache

import "time"

// prefix scopes every chats key on the shared instance; the namespace
// convention is what keeps one instance safe for many services.
const prefix = "chats:"

// TTLs bound every cached entry, so a swept key is indistinguishable from an
// expired one.
const (
	ChatMetaTTL = 10 * time.Minute
	ChatHeadTTL = 10 * time.Minute
	ChatListTTL = 5 * time.Minute
)

// ChatKey is the key of a chat's meta entry.
func ChatKey(chatID string) string {
	return prefix + "chat:" + chatID
}

// ChatHeadKey is the key of a chat's head page of messages.
func ChatHeadKey(chatID string) string {
	return prefix + "chat:" + chatID + ":head"
}

// OwnerChatsKey is the key of an owner's sidebar list.
func OwnerChatsKey(ownerID string) string {
	return prefix + "user:" + ownerID + ":chats"
}
