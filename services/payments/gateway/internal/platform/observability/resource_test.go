package observability

import (
	"testing"

	"github.com/kunalPisolkar24/detectAI/services/payments/gateway/internal/config"
)

func TestDeploymentEnvironmentPrecedence(t *testing.T) {
	cfg := &config.Config{EnvType: "dev"}

	t.Setenv("OTEL_RESOURCE_ATTRIBUTES", "")
	t.Setenv("DEPLOYMENT_ENV", "")
	if got := deploymentEnvironment(cfg); got != "dev" {
		t.Fatalf("fallback must be EnvType, got %q", got)
	}

	t.Setenv("DEPLOYMENT_ENV", "prod")
	if got := deploymentEnvironment(cfg); got != "prod" {
		t.Fatalf("DEPLOYMENT_ENV must win over EnvType, got %q", got)
	}

	t.Setenv("OTEL_RESOURCE_ATTRIBUTES", "deployment.environment=loadtest,custom=1")
	if got := deploymentEnvironment(cfg); got != "loadtest" {
		t.Fatalf("OTEL_RESOURCE_ATTRIBUTES must win, got %q", got)
	}
}

func TestBuildResourceDefaults(t *testing.T) {
	t.Setenv("OTEL_RESOURCE_ATTRIBUTES", "")
	t.Setenv("DEPLOYMENT_ENV", "")
	res, err := BuildResource(&config.Config{})
	if err != nil {
		t.Fatalf("BuildResource failed: %v", err)
	}
	attrs := map[string]string{}
	for _, attr := range res.Attributes() {
		attrs[string(attr.Key)] = attr.Value.AsString()
	}
	if attrs["service.name"] != "payment-gateway" {
		t.Fatalf("default service.name wrong: %q", attrs["service.name"])
	}
	if attrs["service.version"] != "dev" {
		t.Fatalf("default service.version wrong: %q", attrs["service.version"])
	}
	if attrs["deployment.environment"] != "dev" {
		t.Fatalf("default deployment.environment wrong: %q", attrs["deployment.environment"])
	}
}
