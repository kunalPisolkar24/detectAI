package planes

import (
	"fmt"
	"sort"
	"strings"
)

// A prod plane reader the adapters satisfy structurally.
type Plane interface {
	Fetch() (map[string]string, error)
}

// ProdSource merges the Secrets Manager blob with the SSM tree; the process env never reaches it.
type ProdSource struct {
	values map[string]string
}

func NewProdSource(parameters, secrets Plane) (*ProdSource, error) {
	blob, err := secrets.Fetch()
	if err != nil {
		return nil, err
	}
	tree, err := parameters.Fetch()
	if err != nil {
		return nil, err
	}
	seeded := make(map[string]struct{}, len(blob))
	for key := range blob {
		seeded[strings.ToLower(key)] = struct{}{}
	}
	var overlap []string
	for key := range tree {
		if _, collision := seeded[strings.ToLower(key)]; collision {
			overlap = append(overlap, strings.ToLower(key))
		}
	}
	if len(overlap) > 0 {
		sort.Strings(overlap)
		return nil, fmt.Errorf(
			"config: key(s) seeded on both planes: %s; the secrets blob and the SSM prefix are disjoint by contract — remove the duplicates and re-apply (make secrets-apply)",
			strings.Join(overlap, ", "))
	}
	values := make(map[string]string, len(blob)+len(tree))
	for key, value := range blob {
		values[key] = value
	}
	for key, value := range tree {
		values[key] = value
	}
	return &ProdSource{values: values}, nil
}

func (s *ProdSource) Get(key string) (string, bool) {
	value, ok := s.values[key]
	return value, ok
}
