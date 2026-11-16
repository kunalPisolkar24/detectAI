"""The shared Resource: one per process, or service.name splits across dashboards."""

from __future__ import annotations

from opentelemetry.sdk.resources import Resource


def build_resource(
    service_name: str, service_version: str, environment: str
) -> Resource:
    """Legacy + modern deployment labels stamped twice for dashboard NRQL filters."""
    return Resource.create(
        {
            "service.name": service_name,
            "service.version": service_version,
            "deployment.environment": environment,
            "deployment.environment.name": environment,
        }
    )
