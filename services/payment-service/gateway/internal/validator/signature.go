package validator

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"regexp"
)

type SignatureValidator interface {
	Validate(signatureHeader string, body []byte, secret string) bool
}

type PaddleValidator struct {
	tsRegex *regexp.Regexp
	h1Regex *regexp.Regexp
}

func NewPaddleValidator() *PaddleValidator {
	return &PaddleValidator{
		tsRegex: regexp.MustCompile(`ts=(\d+)`),
		h1Regex: regexp.MustCompile(`h1=([a-f0-9]+)`),
	}
}

func (v *PaddleValidator) Validate(signatureHeader string, body []byte, secret string) bool {
	if signatureHeader == "" || secret == "" {
		return false
	}

	tsMatch := v.tsRegex.FindStringSubmatch(signatureHeader)
	h1Match := v.h1Regex.FindStringSubmatch(signatureHeader)

	if len(tsMatch) < 2 || len(h1Match) < 2 {
		return false
	}

	ts := tsMatch[1]
	h1 := h1Match[1]

	payload := ts + ":" + string(body)

	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(payload))
	computedHash := hex.EncodeToString(mac.Sum(nil))

	return hmac.Equal([]byte(computedHash), []byte(h1))
}