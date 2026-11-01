package factories

import (
	"fmt"

	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/config/adapters"
)

// ProdSource is the prod plane: the secrets blob and the SSM tree merged AWS-exact.
// Process env and dotenv never reach this path, so a stray variable cannot leak a
// value in; the two planes are disjoint by seeding contract and a case-insensitive
// key overlap fails the boot.
type ProdSource struct {
	parameters *adapters.ParameterStoreAdapter
	secrets    *adapters.SecretsManagerAdapter
	values     map[string]string
}

// NewProdSource fetches both AWS planes once and merges them with the
// disjointness check; keys seeded after boot stay invisible until a restart.
func NewProdSource(parameters *adapters.ParameterStoreAdapter, secrets *adapters.SecretsManagerAdapter) (*ProdSource, error) {
	return nil, fmt.Errorf("config: NewProdSource is a skeleton; lands with the AWS build")
}

// Get answers from the merged AWS-exact plane.
func (s *ProdSource) Get(key string) (string, bool) {
	value, ok := s.values[key]
	return value, ok
}
