package validator_test

import (
	"errors"
	"io"
	"strings"
	"testing"

	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/validator"
)

// errReader yields err immediately — the unreadable transport case behind 400.
type errReader struct{}

func (errReader) Read([]byte) (int, error) { return 0, io.ErrUnexpectedEOF }

// shortDropReader yields prefix bytes then errors, the transfer-cut-short case.
type shortDropReader struct {
	prefix []byte
}

func (r *shortDropReader) Read(p []byte) (int, error) {
	if len(r.prefix) > 0 {
		n := copy(p, r.prefix)
		r.prefix = r.prefix[n:]
		return n, nil
	}
	return 0, io.ErrUnexpectedEOF
}

func TestReadBoundedAcceptsUpToTheBound(t *testing.T) {
	const max = int64(64)
	byName := map[string][]byte{
		"empty body":        {},
		"half the bound":    bytesOf(32),
		"exactly the bound": bytesOf(64), // the +1 sentinel keeps this legal
	}
	for name, body := range byName {
		t.Run(name, func(t *testing.T) {
			data, err := validator.ReadBounded(strings.NewReader(string(body)), max)
			if err != nil {
				t.Fatal(err)
			}
			if string(data) != string(body) {
				t.Errorf("data = %q, want %q round-tripped", data, body)
			}
		})
	}
}

func TestReadBoundedRejectsOversizeBeforeTheTransportError(t *testing.T) {
	const max = int64(64)
	// Oversize wins even when the client aborted mid-transfer.
	data, err := validator.ReadBounded(
		io.MultiReader(strings.NewReader(string(bytesOf(65))), errReader{}), max)
	if !errors.Is(err, validator.ErrBodyTooLarge) {
		t.Errorf("err = %v, want ErrBodyTooLarge; oversize precedes the transport error", err)
	}
	if data != nil {
		t.Errorf("data = %q, want nil on the failure", data)
	}
}

func TestReadBoundedRejectsShortCorruptTransfersAsMalformed(t *testing.T) {
	_, err := validator.ReadBounded(&shortDropReader{prefix: bytesOf(10)}, 64)
	if !errors.Is(err, validator.ErrBodyMalformed) {
		t.Errorf("err = %v, want ErrBodyMalformed; a short corrupt transfer is 400", err)
	}
}

func TestReadBoundedRejectsFullyUnreadableAsMalformed(t *testing.T) {
	_, err := validator.ReadBounded(errReader{}, 64)
	if !errors.Is(err, validator.ErrBodyMalformed) {
		t.Errorf("err = %v, want ErrBodyMalformed", err)
	}
}

func TestReadBoundedNeverConsumesTheExcess(t *testing.T) {
	const max = int64(64)
	sender := strings.NewReader(string(bytesOf(max + 10)))
	_, err := validator.ReadBounded(sender, max)
	if !errors.Is(err, validator.ErrBodyTooLarge) {
		t.Fatalf("err = %v, want ErrBodyTooLarge", err)
	}
	// The detection window is max+1 bytes of a 74-byte body: 9 bytes follow it.
	if remain := int64(sender.Len()); remain != 9 {
		t.Errorf("unread remainder = %d, want 9; the excess beyond the read window must stay unconsumed", remain)
	}
}

// bytesOf pads a marker string to n bytes so data loss is self-evident.
func bytesOf(n int64) []byte {
	const marker = "xq9z"
	body := make([]byte, 0, n)
	for int64(len(body)) < n {
		body = append(body, marker...)
	}
	return body[:n]
}
