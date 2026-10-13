package observability

import (
	"context"
	"os"
	"strings"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/config"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/sdk/resource"
)

// BuildResource stamps every span and log with the identity the New Relic
// dashboards filter on. Precedence mirrors payment-gateway:
// environment is OTEL_RESOURCE_ATTRIBUTES (deployment.environment=...),
// then DEPLOYMENT_ENV, then ENV_TYPE; version is OTEL_SERVICE_VERSION,
// then SERVICE_VERSION, then dev.
func BuildResource(cfg *config.Config) (*resource.Resource, error) {
	name := strings.TrimSpace(cfg.OtelServiceName)
	if name == "" {
		name = "chat-service"
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
		if k := strings.TrimSpace(kv[0]); k != "" {
			out[k] = strings.TrimSpace(kv[1])
		}
	}
	return out
}
