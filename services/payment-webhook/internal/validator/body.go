package validator

import (
	"errors"
	"io"
)

// Bounded-read failure classes; transport maps them to 413 and 400.
var (
	ErrBodyTooLarge  = errors.New("ingress: body exceeds the bound")
	ErrBodyMalformed = errors.New("ingress: body unreadable")
)

// ReadBounded reads up to max bytes, max included; the max+1 read detects an oversize body.
func ReadBounded(r io.Reader, max int64) ([]byte, error) {
	data, err := io.ReadAll(io.LimitReader(r, max+1))
	if int64(len(data)) > max {
		return nil, ErrBodyTooLarge
	}
	if err != nil {
		return nil, ErrBodyMalformed
	}
	return data, nil
}
