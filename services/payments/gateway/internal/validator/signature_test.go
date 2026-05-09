package validator

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func generateTestSignature(ts, body, secret string) string {
	payload := ts + ":" + body
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(payload))
	return fmt.Sprintf("ts=%s;h1=%s", ts, hex.EncodeToString(mac.Sum(nil)))
}

func TestPaddleValidator_Validate(t *testing.T) {
	v := NewPaddleValidator()
	secret := "test-secret"
	now := fmt.Sprintf("%d", time.Now().Unix())
	body := `{"foo":"bar"}`

	tests := []struct {
		name      string
		header    string
		body      []byte
		secret    string
		wantValid bool
	}{
		{
			name:      "Valid Signature",
			header:    generateTestSignature(now, body, secret),
			body:      []byte(body),
			secret:    secret,
			wantValid: true,
		},
		{
			name:      "Invalid Secret",
			header:    generateTestSignature(now, body, "wrong-secret"),
			body:      []byte(body),
			secret:    secret,
			wantValid: false,
		},
		{
			name:      "Tampered Body",
			header:    generateTestSignature(now, body, secret),
			body:      []byte(`{"foo":"baz"}`),
			secret:    secret,
			wantValid: false,
		},
		{
			name:      "Malformed Header",
			header:    "ts=123;h1=invalid",
			body:      []byte(body),
			secret:    secret,
			wantValid: false,
		},
		{
			name:      "Expired Timestamp",
			header:    generateTestSignature(fmt.Sprintf("%d", time.Now().Unix()-600), body, secret),
			body:      []byte(body),
			secret:    secret,
			wantValid: false,
		},
		{
			name:      "Empty Inputs",
			header:    "",
			body:      nil,
			secret:    "",
			wantValid: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := v.Validate(tt.header, tt.body, tt.secret)
			assert.Equal(t, tt.wantValid, got)
		})
	}
}