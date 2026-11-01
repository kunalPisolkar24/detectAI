// Package config contracts hub: the plane vocabulary lives here so consumers
// navigate from one file; its declarations are backed by their owners below.
package config

import "github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/config/planes"

// Source is the plane contract the planes package owns — the factory wires it
// and Resolve reads it.
type Source = planes.Source

// Compile-time check: the plane sources speak Source.
var (
	_ Source = (*planes.DevSource)(nil)
	_ Source = (*planes.ProdSource)(nil)
)
