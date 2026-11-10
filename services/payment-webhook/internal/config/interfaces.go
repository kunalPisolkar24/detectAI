package config

import (
	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/config/adapters"
	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/config/planes"
)

// Source is the plane contract the planes package owns.
type Source = planes.Source

// Compile-time seams: the plane sources satisfy Source, the AWS readers satisfy Plane.
var (
	_ Source = (*planes.DevSource)(nil)
	_ Source = (*planes.ProdSource)(nil)

	_ planes.Plane = (*adapters.SecretsManagerAdapter)(nil)
	_ planes.Plane = (*adapters.ParameterStoreAdapter)(nil)
)
