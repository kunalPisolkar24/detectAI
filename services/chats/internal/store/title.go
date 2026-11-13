package store

import (
	"strings"
	"unicode/utf8"
)

// DeriveChatTitle derives a chat's title from the message that opened it.
func DeriveChatTitle(initialMessage string) string {
	title := strings.TrimSpace(initialMessage)
	if utf8.RuneCountInString(title) > MaxTitleLen {
		title = string([]rune(title)[:MaxTitleLen])
	}
	return title
}
