package adapters

import "fmt"

// SecretsManagerAdapter reads the service's secrets blob for the prod plane under
// a JSON-object contract of key/value strings.
type SecretsManagerAdapter struct{}

// NewSecretsManagerAdapter fetches the blob once at construction.
func NewSecretsManagerAdapter() (*SecretsManagerAdapter, error) {
	return nil, fmt.Errorf("config: NewSecretsManagerAdapter is a skeleton; lands with the AWS build")
}

// Fetch returns the plane's key/value map; callers must treat it as read-only.
func (a *SecretsManagerAdapter) Fetch() (map[string]string, error) {
	return nil, fmt.Errorf("config: SecretsManagerAdapter.Fetch is a skeleton; lands with the AWS build")
}
