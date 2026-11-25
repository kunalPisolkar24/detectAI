package models

import (
	"database/sql"
	"time"

	"github.com/google/uuid"
)

type Credentials struct {
	UserID       uuid.UUID
	PasswordHash string
	TokenVersion int
}

type User struct {
	ID              uuid.UUID
	Email           string
	Name            sql.NullString
	FirstName       sql.NullString
	LastName        sql.NullString
	Image           sql.NullString
	EmailVerifiedAt sql.NullTime
	PasswordHash    sql.NullString
	TokenVersion    int
	CreatedAt       time.Time
	UpdatedAt       time.Time
}
