package observability

import (
	"context"
	"os"
	"strings"

	"github.com/kunalPisolkar24/detectAI/services/payments/gateway/internal/config"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/sdk/resource"
)

func BuildResource(cfg *config.Config) (*resource.Resource, error) {
	name := strings.TrimSpace(cfg.OtelServiceName)
	if name == "" {
		name = "payment-gateway"
	}
	version := strings.TrimSpace(cfg.OtelServiceVersion)
	if version == "" {
		version = "dev"
	}
	return resource.New(
		context.Background(),
		resource.WithFromEnv(),
		resource.WithAttributes(
			attribute.String("service.name", name),
			attribute.String("service.version", version),
			attribute.String("deployment.environment", deploymentEnvironment(cfg)),
		),
	)
}

func deploymentEnvironment(cfg *config.Config) string {
	if v, ok := resourceAttributes()["deployment.environment"]; ok && v != "" {
		return v
	}
	if v := strings.TrimSpace(os.Getenv("DEPLOYMENT_ENV")); v != "" {
		return v
	}
	if v := strings.TrimSpace(cfg.EnvType); v != "" {
		return v
	}
	return "dev"
}

func resourceAttributes() map[string]string {
	out := map[string]string{}
	for _, pair := range strings.Split(os.Getenv("OTEL_RESOURCE_ATTRIBUTES"), ",") {
		kv := strings.SplitN(strings.TrimSpace(pair), "=", 2)
		if len(kv) != 2 {
			continue
		}
		k := strings.TrimSpace(kv[0])
		v := strings.TrimSpace(kv[1])
		if k != "" {
			out[k] = v
		}
	}
	return out
}
