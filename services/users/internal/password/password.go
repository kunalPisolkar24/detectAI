// Package password hashes and verifies passwords with Argon2id.
package password

import (
	"errors"
	"fmt"

	"github.com/alexedwards/argon2id"
)

const MaxPasswordBytes = 1024

var (
	ErrTooLong     = errors.New("password: password exceeds maximum length")
	ErrInvalidHash = errors.New("password: invalid hash")
)

var params = &argon2id.Params{
	Memory:      19 * 1024,
	Iterations:  2,
	Parallelism: 1,
	SaltLength:  16,
	KeyLength:   32,
}

const (
	maxMemory      = 64 * 1024
	maxIterations  = 10
	maxParallelism = 4
	maxSaltLength  = 64
	maxKeyLength   = 128
)

type Hasher interface {
	Hash(password string) (string, error)
	Verify(hash, password string) (bool, error)
}

type argon2Hasher struct{}

var _ Hasher = (*argon2Hasher)(nil)

func New() Hasher {
	return &argon2Hasher{}
}

func (*argon2Hasher) Hash(password string) (string, error) {
	if len(password) > MaxPasswordBytes {
		return "", ErrTooLong
	}
	hash, err := argon2id.CreateHash(password, params)
	if err != nil {
		return "", fmt.Errorf("password: create hash: %w", err)
	}
	return hash, nil
}

func (*argon2Hasher) Verify(hash, password string) (bool, error) {
	if len(password) > MaxPasswordBytes {
		return false, ErrTooLong
	}
	decoded, _, _, err := argon2id.DecodeHash(hash)
	if err != nil {
		return false, fmt.Errorf("password: %w: %w", ErrInvalidHash, err)
	}
	// Stored hashes carry their own params; reject out-of-range values so a
	// corrupt or hostile hash cannot force an oversized allocation.
	if !withinBounds(decoded) {
		return false, ErrInvalidHash
	}
	match, err := argon2id.ComparePasswordAndHash(password, hash)
	if err != nil {
		return false, fmt.Errorf("password: compare hash: %w", err)
	}
	return match, nil
}

func withinBounds(p *argon2id.Params) bool {
	return p.Memory > 0 && p.Memory <= maxMemory &&
		p.Iterations > 0 && p.Iterations <= maxIterations &&
		p.Parallelism > 0 && p.Parallelism <= maxParallelism &&
		p.SaltLength > 0 && p.SaltLength <= maxSaltLength &&
		p.KeyLength > 0 && p.KeyLength <= maxKeyLength
}
