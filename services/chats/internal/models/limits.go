package models

// Bounds and limit clamps the contract's validation enforces; the spec names
// no maximums, so these numbers are this repo's recorded decisions.
const (
	MaxTitleLen   = 200
	MaxContentLen = 100000

	DefaultHistoryLimit = 50
	MaxHistoryLimit     = 200
	DefaultChatsLimit   = 50
	MaxChatsLimit       = 200
)

// ClampHistoryLimit applies the history limit's server default and hard cap.
func ClampHistoryLimit(limit int) int {
	return clamp(limit, DefaultHistoryLimit, MaxHistoryLimit)
}

// ClampChatsLimit applies the sidebar limit's server default and hard cap.
func ClampChatsLimit(limit int) int {
	return clamp(limit, DefaultChatsLimit, MaxChatsLimit)
}

func clamp(limit, fallback, maximum int) int {
	if limit <= 0 {
		return fallback
	}
	if limit > maximum {
		return maximum
	}
	return limit
}
