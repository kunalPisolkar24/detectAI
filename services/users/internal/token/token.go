// Package token issues and verifies access tokens and generates refresh tokens.
package token

import (
	"errors"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

var (
	ErrInvalidToken        = errors.New("token: invalid access token")
	ErrInvalidRefreshToken = errors.New("token: invalid refresh token")
	ErrInvalidKey          = errors.New("token: invalid key")
	ErrInvalidTTL          = errors.New("token: invalid token TTL")
)

type Claims struct {
	jwt.RegisteredClaims
	UserID  uuid.UUID `json:"-"`
	Version int       `json:"ver"`
}

type AccessIssuer interface {
	Issue(userID uuid.UUID, version int) (string, time.Time, error)
}

type AccessVerifier interface {
	Verify(raw string) (Claims, error)
}
