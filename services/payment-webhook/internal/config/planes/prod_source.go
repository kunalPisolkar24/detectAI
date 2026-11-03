package planes

import (
	"fmt"

	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/config/adapters"
)

// ProdSource merges the Secrets Manager blob with the SSM tree; the process env
// never reaches it, so a stray environment variable cannot leak a value in.
type ProdSource struct {
	parameters *adapters.ParameterStoreAdapter
	secrets    *adapters.SecretsManagerAdapter
	values     map[string]string
}

// NewProdSource fetches both AWS planes once; keys seeded after boot are
// invisible until a restart.
func NewProdSource(parameters *adapters.ParameterStoreAdapter, secrets *adapters.SecretsManagerAdapter) (*ProdSource, error) {
	return nil, fmt.Errorf("config: NewProdSource is a skeleton; lands with the AWS build")
}

func (s *ProdSource) Get(key string) (string, bool) {
	value, ok := s.values[key]
	return value, ok
}
