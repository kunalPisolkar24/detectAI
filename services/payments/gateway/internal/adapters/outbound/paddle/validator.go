package paddle

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"regexp"
	"strconv"
	"time"

	"github.com/kunalPisolkar24/detectAI/services/payments/gateway/internal/ports"
)

type Validator struct {
	tsRegex *regexp.Regexp
	h1Regex *regexp.Regexp
}

func NewValidator() ports.SignatureValidator {
	return &Validator{
		tsRegex: regexp.MustCompile(`ts=(\d+)`),
		h1Regex: regexp.MustCompile(`h1=([a-f0-9]+)`),
	}
}

func NewPaddleValidator() ports.SignatureValidator {
	return NewValidator()
}

func (v *Validator) Validate(signatureHeader string, body []byte, secret string) bool {
	if signatureHeader == "" || secret == "" {
		return false
	}
	tsMatch := v.tsRegex.FindStringSubmatch(signatureHeader)
	h1Match := v.h1Regex.FindStringSubmatch(signatureHeader)
	if len(tsMatch) < 2 || len(h1Match) < 2 {
		return false
	}
	tsStr := tsMatch[1]
	h1 := h1Match[1]
	ts, err := strconv.ParseInt(tsStr, 10, 64)
	if err != nil {
		return false
	}
	if time.Since(time.Unix(ts, 0)) > 5*time.Minute || time.Until(time.Unix(ts, 0)) > 5*time.Minute {
		return false
	}
	payload := tsStr + ":" + string(body)
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(payload))
	computed := hex.EncodeToString(mac.Sum(nil))
	return hmac.Equal([]byte(computed), []byte(h1))
}
