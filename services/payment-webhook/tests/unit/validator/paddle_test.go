package validator_test

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/validator"
)

const secret = "paddle-change-me-16-chars"

var validBody = []byte(`{"event_type":"subscription.updated","data":{"id":"ctm_123"}}`)

// time-based vectors are computed from time.Now at test runtime: the valid
// margins sit inside the window by whole seconds, so no clock seam is needed —
// implementation latency cannot push them across the edge.
func freshTS(t *testing.T) string {
	t.Helper()
	return strconv.FormatInt(time.Now().Unix(), 10)
}

func staleTS(t *testing.T) string { // −5 min − 1 s
	t.Helper()
	return strconv.FormatInt(time.Now().Unix()-301, 10)
}

func futureTS(t *testing.T) string { // +5 min + 1 s
	t.Helper()
	return strconv.FormatInt(time.Now().Unix()+301, 10)
}

func insideTS(t *testing.T) string { // −4:59, safely inside the window
	t.Helper()
	return strconv.FormatInt(time.Now().Unix()-299, 10)
}

// sign recomputes the exact header Paddle sends: HMAC over "<ts>:<body>" framed
// with the literal ts string.
func sign(ts string, body []byte) string {
	tsPart, h1Part := signParts(ts, body)
	return fmt.Sprintf("ts=%s;h1=%s", tsPart, h1Part)
}

func signParts(ts string, body []byte) (string, string) {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(ts + ":"))
	mac.Write(body)
	return ts, hex.EncodeToString(mac.Sum(nil))
}

func TestVerifyAcceptsPaddleShapedHeaders(t *testing.T) {
	v := validator.NewPaddle(secret)
	cases := map[string]struct {
		ts    string
		body  []byte
		extra string
	}{
		"fresh timestamp":   {ts: freshTS(t), body: validBody},
		"inside the window": {ts: insideTS(t), body: validBody},
		"zero-padded ts":    {ts: freshTS(t), body: validBody, extra: "padded"}, // framing uses the literal string
		"empty body":        {ts: freshTS(t), body: []byte{}},
		"other key order":   {ts: freshTS(t), body: validBody, extra: "order"},
		"large body":        {ts: freshTS(t), body: make([]byte, 1<<20)},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			ts := tc.ts
			if tc.extra == "padded" { // leading zero epoch — framing must use the literal string
				ts = "0" + ts
			}
			header := sign(ts, tc.body)
			if tc.extra == "order" { // h1 first — either order is valid
				_, h1 := signParts(tc.ts, tc.body)
				header = fmt.Sprintf("h1=%s;ts=%s", h1, tc.ts)
			}
			if err := v.Verify(header, tc.body); err != nil {
				t.Errorf("err = %v, want nil", err)
			}
		})
	}
}

func TestVerifyRejectsEverythingInvalidIdentically(t *testing.T) {
	v := validator.NewPaddle(secret)

	t.Run("tampered body", func(t *testing.T) {
		err := v.Verify(sign(freshTS(t), validBody), []byte(`{"event_type":"tampered"}`))
		want(t, err)
	})
	t.Run("wrong secret", func(t *testing.T) {
		header := signToo("another-secret-16-chars", freshTS(t), validBody)
		want(t, v.Verify(header, validBody))
	})
	t.Run("stale timestamp", func(t *testing.T) {
		want(t, v.Verify(sign(staleTS(t), validBody), validBody))
	})
	t.Run("future-dated timestamp", func(t *testing.T) {
		want(t, v.Verify(sign(futureTS(t), validBody), validBody))
	})
	t.Run("every malformed fragment", func(t *testing.T) {
		fragments := map[string]string{
			"missing header": "",
			"garbage":        "not-a-paddle-header",
			"no kv pairs":    "ts;h1",
			"ts only":        "ts=" + freshTS(t),
			"empty ts value": "ts=;h1=" + strings.Repeat("a", 64),
			"empty h1 value": "ts=" + freshTS(t) + ";h1=",
			"empty key":      "=" + freshTS(t) + ";" + "h1=" + strings.Repeat("a", 64),
			"third segment":  "ts=" + freshTS(t) + ";h1=" + strings.Repeat("a", 64) + ";junk=0",
			"duplicate key":  "ts=" + freshTS(t) + ";ts=1700000001",
			"non-digit ts":   "ts=1700000000.5;h1=" + strings.Repeat("a", 64),
			"signed ts":      "ts=+1700000000;h1=" + strings.Repeat("a", 64),
			"uppercase hex":  "ts=" + freshTS(t) + ";h1=" + strings.ToUpper(strings.Repeat("a", 64)),
			"one char short": "ts=" + freshTS(t) + ";h1=" + strings.Repeat("a", 63),
			"one char long":  "ts=" + freshTS(t) + ";h1=" + strings.Repeat("a", 65),
			"non-hex digest": "ts=" + freshTS(t) + ";h1=" + strings.Repeat("g", 64),
		}
		for name, header := range fragments {
			t.Run(name, func(t *testing.T) {
				want(t, v.Verify(header, validBody))
			})
		}
	})
	t.Run("empty secret guards defensively", func(t *testing.T) {
		empty := validator.NewPaddle("")
		want(t, empty.Verify(sign(freshTS(t), validBody), validBody))
	})
}

func want(t *testing.T, err error) {
	t.Helper()
	if !errors.Is(err, validator.ErrInvalid) {
		t.Errorf("err = %v, want ErrInvalid — every failure class must collapse to one error", err)
	}
}

func signToo(sec string, ts string, body []byte) string {
	mac := hmac.New(sha256.New, []byte(sec))
	mac.Write([]byte(ts + ":"))
	mac.Write(body)
	return fmt.Sprintf("ts=%s;h1=%s", ts, hex.EncodeToString(mac.Sum(nil)))
}
