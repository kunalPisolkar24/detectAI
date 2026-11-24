package models

import (
	"database/sql"
	"time"

	"github.com/google/uuid"
)

type Provider string

const (
	ProviderGoogle Provider = "google"
	ProviderGitHub Provider = "github"
)

func (p Provider) Valid() bool {
	return p == ProviderGoogle || p == ProviderGitHub
}

type Identity struct {
	ID                uuid.UUID
	UserID            uuid.UUID
	Provider          Provider
	ProviderAccountID string
	ProviderEmail     sql.NullString
	CreatedAt         time.Time
	UpdatedAt         time.Time
}
