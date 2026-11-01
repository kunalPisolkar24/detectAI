// Package planes holds the plane contract and the two plane sources: the
// factories select and wire them, and nothing else names them.
package planes

// Source is the plane contract: absence is a normal answer, never an error.
type Source interface {
	Get(key string) (string, bool)
}
