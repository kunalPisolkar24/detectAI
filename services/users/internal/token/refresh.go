package token

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"time"
)

const refreshTokenBytes = 32

type RefreshToken struct {
	Value     string
	Hash      []byte
	ExpiresAt time.Time
}

type RefreshTokens struct {
	ttl time.Duration
	now func() time.Time
}

func NewRefreshTokens(ttl time.Duration) (*RefreshTokens, error) {
	if ttl <= 0 {
		return nil, ErrInvalidTTL
	}
	return &RefreshTokens{ttl: ttl, now: time.Now}, nil
}

func (r *RefreshTokens) New() (RefreshToken, error) {
	raw := make([]byte, refreshTokenBytes)
	if _, err := rand.Read(raw); err != nil {
		return RefreshToken{}, fmt.Errorf("token: generate refresh token: %w", err)
	}
	value := base64.RawURLEncoding.EncodeToString(raw)
	return RefreshToken{
		Value:     value,
		Hash:      digest(value),
		ExpiresAt: r.now().UTC().Add(r.ttl),
	}, nil
}

func (r *RefreshTokens) Hash(raw string) ([]byte, error) {
	decoded, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil || len(decoded) != refreshTokenBytes {
		return nil, ErrInvalidRefreshToken
	}
	return digest(raw), nil
}

func digest(raw string) []byte {
	sum := sha256.Sum256([]byte(raw))
	return sum[:]
}
