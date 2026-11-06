package config

import (
	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/config/adapters"
	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/config/planes"
)

// Source is the plane contract the planes package owns.
type Source = planes.Source

// Compile-time checks: the plane sources satisfy Source, and the AWS readers satisfy the Plane seam.
var (
	_ Source = (*planes.DevSource)(nil)
	_ Source = (*planes.ProdSource)(nil)

	_ planes.Plane = (*adapters.SecretsManagerAdapter)(nil)
	_ planes.Plane = (*adapters.ParameterStoreAdapter)(nil)
)
