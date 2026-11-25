package models

import (
	"database/sql"
	"time"

	"github.com/google/uuid"
)

type RefreshToken struct {
	ID        uuid.UUID
	UserID    uuid.UUID
	TokenHash []byte
	ExpiresAt time.Time
	RevokedAt sql.NullTime
	CreatedAt time.Time
	UpdatedAt time.Time
}

type RefreshTokenLookup struct {
	Token        RefreshToken
	TokenVersion int
}
