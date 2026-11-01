package adapters

import "fmt"

// ParameterStoreAdapter reads the SSM tree under the service's config prefix for
// the prod plane: paged, prefix-stripped, plain String entries only.
type ParameterStoreAdapter struct{}

// NewParameterStoreAdapter fetches the SSM tree once at construction.
func NewParameterStoreAdapter() (*ParameterStoreAdapter, error) {
	return nil, fmt.Errorf("config: NewParameterStoreAdapter is a skeleton; lands with the AWS build")
}

// Fetch returns the plane's key/value map; callers must treat it as read-only.
func (a *ParameterStoreAdapter) Fetch() (map[string]string, error) {
	return nil, fmt.Errorf("config: ParameterStoreAdapter.Fetch is a skeleton; lands with the AWS build")
}
