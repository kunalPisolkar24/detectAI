package validator

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strconv"
	"strings"
	"time"
)

// maxSignatureAge is Paddle's ±5 minute freshness window; the exact boundary is
// untested on purpose — a false invalid there is harmless under Paddle's retries.
const maxSignatureAge = 5 * time.Minute

// ErrInvalid collapses every signature failure class; callers cannot tell which failed.
var ErrInvalid = errors.New("paddle: invalid signature")

// Paddle authenticates raw ingress bodies before any other work.
type Paddle struct {
	secret string
}

func NewPaddle(secret string) *Paddle {
	return &Paddle{secret: secret}
}

// Verify recomputes the constant-time HMAC over "<ts>:<raw-body>"; the header's
// ts string frames it verbatim, never reformatted to an integer.
func (v *Paddle) Verify(header string, body []byte) error {
	if v.secret == "" {
		return ErrInvalid
	}
	ts, h1, ok := parseHeader(header)
	if !ok {
		return ErrInvalid
	}
	tsInt, err := strconv.ParseInt(ts, 10, 64)
	if err != nil {
		return ErrInvalid
	}
	if time.Since(time.Unix(tsInt, 0)).Abs() > maxSignatureAge {
		return ErrInvalid
	}
	mac := hmac.New(sha256.New, []byte(v.secret))
	mac.Write([]byte(ts + ":"))
	mac.Write(body)
	if !hmac.Equal([]byte(hex.EncodeToString(mac.Sum(nil))), []byte(h1)) {
		return ErrInvalid
	}
	return nil
}

// parseHeader splits the ts/h1 segments; both orders are accepted, duplicates
// and extras are invalid.
func parseHeader(header string) (ts, h1 string, ok bool) {
	segments := strings.Split(header, ";")
	if len(segments) != 2 {
		return "", "", false
	}
	fields := make(map[string]string, 2)
	for _, segment := range segments {
		key, value, found := strings.Cut(segment, "=")
		if !found || key == "" || value == "" {
			return "", "", false
		}
		if _, duplicate := fields[key]; duplicate {
			return "", "", false
		}
		fields[key] = value
	}
	ts, h1 = fields["ts"], fields["h1"]
	if !isDigits(ts) || !isLowerHex(h1) {
		return "", "", false
	}
	return ts, h1, true
}

func isDigits(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

func isLowerHex(s string) bool {
	if len(s) != sha256.Size*2 {
		return false
	}
	for _, r := range s {
		if (r < '0' || r > '9') && (r < 'a' || r > 'f') {
			return false
		}
	}
	return true
}
