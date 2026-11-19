// Package planes holds the plane sources and the Source contract.
package planes

// Source is a plane string lookup; absence is a normal result, never an error.
type Source interface {
	Get(key string) (string, bool)
}
