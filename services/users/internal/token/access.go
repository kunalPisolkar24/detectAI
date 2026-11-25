package token

import (
	"crypto/ed25519"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

type accessIssuer struct {
	key ed25519.PrivateKey
	ttl time.Duration
	now func() time.Time
}

var _ AccessIssuer = (*accessIssuer)(nil)

func NewAccessIssuer(key ed25519.PrivateKey, ttl time.Duration) (AccessIssuer, error) {
	if len(key) != ed25519.PrivateKeySize {
		return nil, ErrInvalidKey
	}
	if ttl <= 0 {
		return nil, ErrInvalidTTL
	}
	return &accessIssuer{key: key, ttl: ttl, now: time.Now}, nil
}

func (i *accessIssuer) Issue(userID uuid.UUID, version int) (string, time.Time, error) {
	issuedAt := i.now().UTC().Truncate(time.Second)
	expiresAt := issuedAt.Add(i.ttl)
	claims := Claims{
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   userID.String(),
			IssuedAt:  jwt.NewNumericDate(issuedAt),
			ExpiresAt: jwt.NewNumericDate(expiresAt),
		},
		Version: version,
	}
	raw, err := jwt.NewWithClaims(jwt.SigningMethodEdDSA, claims).SignedString(i.key)
	if err != nil {
		return "", time.Time{}, fmt.Errorf("token: sign access token: %w", err)
	}
	return raw, expiresAt, nil
}

type accessVerifier struct {
	key ed25519.PublicKey
	now func() time.Time
}

var _ AccessVerifier = (*accessVerifier)(nil)

func NewAccessVerifier(key ed25519.PublicKey) (AccessVerifier, error) {
	if len(key) != ed25519.PublicKeySize {
		return nil, ErrInvalidKey
	}
	return &accessVerifier{key: key, now: time.Now}, nil
}

func (v *accessVerifier) Verify(raw string) (Claims, error) {
	claims := Claims{}
	_, err := jwt.ParseWithClaims(raw, &claims, func(*jwt.Token) (any, error) {
		return v.key, nil
	},
		jwt.WithValidMethods([]string{"EdDSA"}),
		jwt.WithExpirationRequired(),
		jwt.WithIssuedAt(),
		jwt.WithTimeFunc(v.now),
	)
	if err != nil {
		return Claims{}, fmt.Errorf("token: %w: %w", ErrInvalidToken, err)
	}
	userID, err := uuid.Parse(claims.Subject)
	if err != nil {
		return Claims{}, fmt.Errorf("token: %w: invalid subject", ErrInvalidToken)
	}
	claims.UserID = userID
	return claims, nil
}
