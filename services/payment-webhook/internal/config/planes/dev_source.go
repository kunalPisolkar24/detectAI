package planes

import (
	"fmt"

	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/config/adapters"
)

// DevSource is the dev plane: the process environment over the parsed dotenv file
// (env wins — a container ships no file and receives its values injected).
type DevSource struct {
	values map[string]string
}

// NewDevSource takes the dotenv plane the file reader parsed and merges the
// process env over it: the reader owns parsing and the missing/malformed-file
// failure contract, the plane owns precedence.
func NewDevSource(dotenv *adapters.DotEnvAdapter, environ []string) (*DevSource, error) {
	return nil, fmt.Errorf("config: NewDevSource is a skeleton; the wire-up build merges the dotenv plane and the environment")
}

// Get answers from the merged plane values.
func (s *DevSource) Get(key string) (string, bool) {
	value, ok := s.values[key]
	return value, ok
}
