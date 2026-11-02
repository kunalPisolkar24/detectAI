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

// Everything past Paddle's ±5 min freshness window is invalid (http.md); the
// exactly-at-window edge is valid, and untested on purpose — a false invalid
// there is harmless by Paddle's retry design, and no clock seam exists to pin
// it.
const maxSignatureAge = 5 * time.Minute

// ErrInvalid is every signature failure class collapsed: missing, malformed,
// stale, future-dated, or tampered (FR-2). Callers cannot tell which failed.
var ErrInvalid = errors.New("paddle: invalid signature")

// Paddle authenticates raw ingress bodies before any other work (FR-1).
type Paddle struct {
	secret string
}

// NewPaddle binds the webhook secret; the boot owns the credential, the caller
// never sees it.
func NewPaddle(secret string) *Paddle {
	return &Paddle{secret: secret}
}

// Verify recomputes Paddle's HMAC-SHA256 over "<ts>:<raw-body>" and compares
// the lowercase hex digest in constant time. The header's literal ts string is
// the HMAC framing, never a reformatted integer, so zero-padded timestamps
// verify against the exact bytes Paddle hashed.
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

// parseHeader splits Paddle's "ts=<unix-seconds>;h1=<64 hex>" header: exactly
// two key=value segments in either order, no duplicates, no extra keys. Keys
// accept either order because Paddle's own header contract is key-bearing, not
// positional; everything else — empty header included — is invalid.
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
