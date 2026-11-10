package ports

import (
	"errors"
	"strings"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/core/domain"
)

var transientSubstrings = []string{
	"connection refused",
	"connection reset",
	"broken pipe",
	"use of closed network connection",
	"eof",
	"i/o timeout",
	"timeout",
	"no such host",
	"dial tcp",
	"client is closed",
	"no reachable servers",
	"server selection error",
	"network error",
	"connection closed",
}

func IsTransient(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, domain.ErrUnavailable) {
		return true
	}
	msg := strings.ToLower(err.Error())
	for _, s := range transientSubstrings {
		if strings.Contains(msg, s) {
			return true
		}
	}
	return false
}
