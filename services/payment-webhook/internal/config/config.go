package config

import "time"

// Config is the typed boot contract — the single place that talks types, bounds,
// and failure behavior. Fields land when runtime code consumes them
// (consume-first); plane keys without a field are ignored.
type Config struct {
	Port         int
	DrainTimeout time.Duration
}

// Resolve reads the declared fields off one plane source: each field is read by
// its env name, and the field's own contract owns its failure behavior.
func Resolve(source Source) (Config, error) {
	return Config{}, skeleton("Resolve")
}
