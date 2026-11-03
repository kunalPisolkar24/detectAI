package config

import "github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/config/planes"

// Source is the plane contract the planes package owns.
type Source = planes.Source

// Compile-time check that the plane sources satisfy Source.
var (
	_ Source = (*planes.DevSource)(nil)
	_ Source = (*planes.ProdSource)(nil)
)
