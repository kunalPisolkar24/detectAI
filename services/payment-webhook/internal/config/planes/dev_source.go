package planes

import (
	"strings"

	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/config/adapters"
)

// DevSource merges the process environment over the parsed dotenv file; env wins.
type DevSource struct {
	values map[string]string
}

func NewDevSource(dotenv *adapters.DotEnvAdapter, environ []string) (*DevSource, error) {
	values := make(map[string]string)
	for key, value := range dotenv.Fetch() {
		values[key] = value
	}
	for _, entry := range environ {
		key, value, ok := strings.Cut(entry, "=")
		if !ok || key == "" {
			continue
		}
		values[key] = value
	}
	return &DevSource{values: values}, nil
}

func (s *DevSource) Get(key string) (string, bool) {
	value, ok := s.values[key]
	return value, ok
}
