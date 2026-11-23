package planes

// Source is a plane string lookup; absence is a normal result, never an error.
type Source interface {
	Get(key string) (string, bool)
}
