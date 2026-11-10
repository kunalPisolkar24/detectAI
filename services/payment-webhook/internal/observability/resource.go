package observability

import "go.opentelemetry.io/otel/attribute"
import "go.opentelemetry.io/otel/sdk/resource"

// buildResource stamps the deployment labels; the attribute keys are hand-spelled
// so a semconv bump cannot rename the NRQL surface.
func buildResource(serviceName, serviceVersion, environment string) *resource.Resource {
	return resource.NewSchemaless(
		attribute.String("service.name", serviceName),
		attribute.String("service.version", serviceVersion),
		attribute.String("deployment.environment", environment),
		attribute.String("deployment.environment.name", environment),
	)
}
