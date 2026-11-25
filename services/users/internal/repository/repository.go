// Package repository adapts the generated sqlc queries to the service's domain models.
package repository

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/kunalPisolkar24/detectAI/services/users/internal/db/sqlc"
	"github.com/kunalPisolkar24/detectAI/services/users/internal/models"
)

type Postgres struct {
	queries sqlc.Querier
}

var (
	_ UserRepository         = (*Postgres)(nil)
	_ AuthIdentityRepository = (*Postgres)(nil)
	_ RefreshTokenRepository = (*Postgres)(nil)
)

func New(queries sqlc.Querier) *Postgres {
	return &Postgres{queries: queries}
}

func wrap(op string, err error, notFound, conflict error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, pgx.ErrNoRows) && notFound != nil {
		return fmt.Errorf("repository: %s: %w: %w", op, notFound, err)
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch pgErr.Code {
		case "23505":
			if conflict != nil {
				return fmt.Errorf("repository: %s: %w: %w", op, conflict, err)
			}
		case "23503":
			if notFound != nil {
				return fmt.Errorf("repository: %s: %w: %w", op, notFound, err)
			}
		}
	}
	if pgconn.Timeout(err) || pgconn.SafeToRetry(err) || errors.Is(err, context.Canceled) {
		return fmt.Errorf("repository: %s: %w: %w", op, models.ErrUnavailable, err)
	}
	return fmt.Errorf("repository: %s: %w", op, err)
}

func nullString(value string) sql.NullString {
	if value == "" {
		return sql.NullString{}
	}
	return sql.NullString{String: value, Valid: true}
}

func text(value sql.NullString) string {
	if !value.Valid {
		return ""
	}
	return value.String
}

func nullTime(value pgtype.Timestamptz) sql.NullTime {
	if !value.Valid {
		return sql.NullTime{}
	}
	return sql.NullTime{Time: value.Time, Valid: true}
}

func timestamp(value time.Time) pgtype.Timestamptz {
	return pgtype.Timestamptz{Time: value, Valid: true}
}
