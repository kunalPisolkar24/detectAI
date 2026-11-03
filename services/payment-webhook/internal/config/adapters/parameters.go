package adapters

import "fmt"

// ParameterStoreAdapter reads the service's SSM tree: paged, prefix-stripped, plain strings.
type ParameterStoreAdapter struct{}

func NewParameterStoreAdapter() (*ParameterStoreAdapter, error) {
	return nil, fmt.Errorf("config: NewParameterStoreAdapter is a skeleton; lands with the AWS build")
}

// Fetch returns the plane's key/value map; treat it as read-only.
func (a *ParameterStoreAdapter) Fetch() (map[string]string, error) {
	return nil, fmt.Errorf("config: ParameterStoreAdapter.Fetch is a skeleton; lands with the AWS build")
}
