package validator

import (
	"errors"
	"io"
)

// The bounded-read outcomes; transport maps them to 413 and 400. The validator
// names the failure class only — the response stays the handler's decision.
var (
	ErrBodyTooLarge  = errors.New("ingress: body exceeds the bound")
	ErrBodyMalformed = errors.New("ingress: body unreadable")
)

// ReadBounded reads up to max bytes, a body of exactly max bytes included
// (NFR-4). The limit+1 sentinel read bounds detection at max+1 bytes of memory
// so an oversize body answers before the excess is consumed. Oversize precedes
// a transport error: a client that sent past the bound gets the failure class
// it caused, and a short corrupted transfer the 400 class.
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
