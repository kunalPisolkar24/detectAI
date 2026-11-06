package observability

import "go.opentelemetry.io/otel/attribute"
import "go.opentelemetry.io/otel/sdk/resource"

// buildResource stamps the deployment labels once per process; direct push
// means the app owns what the in-stack collector used to upsert. The attribute
// keys are the NRQL surface the boards and alerts filter on — hand-spelled so
// a semconv version bump can never silently rename the contract.
func buildResource(serviceName, serviceVersion, environment string) *resource.Resource {
	return resource.NewSchemaless(
		attribute.String("service.name", serviceName),
		attribute.String("service.version", serviceVersion),
		attribute.String("deployment.environment", environment),
		attribute.String("deployment.environment.name", environment),
	)
}
