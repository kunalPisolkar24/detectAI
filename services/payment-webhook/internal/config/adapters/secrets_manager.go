package adapters

import "fmt"

// SecretsManagerAdapter reads the service's secrets blob as a JSON object of key/value strings.
type SecretsManagerAdapter struct{}

func NewSecretsManagerAdapter() (*SecretsManagerAdapter, error) {
	return nil, fmt.Errorf("config: NewSecretsManagerAdapter is a skeleton; lands with the AWS build")
}

// Fetch returns the plane's key/value map; treat it as read-only.
func (a *SecretsManagerAdapter) Fetch() (map[string]string, error) {
	return nil, fmt.Errorf("config: SecretsManagerAdapter.Fetch is a skeleton; lands with the AWS build")
}
