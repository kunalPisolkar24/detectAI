// Package config contracts hub: the plane vocabulary lives here so consumers
// navigate from one file; its declarations are backed by their owners below.
package config

import "github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/config/factories"

// Source is the plane contract the factories compose and Resolve reads.
type Source = factories.Source

// Compile-time check: the plane sources speak Source.
var (
	_ Source = (*factories.DevSource)(nil)
	_ Source = (*factories.ProdSource)(nil)
)
