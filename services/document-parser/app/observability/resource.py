"""The shared Resource: built once, handed to all three providers.

Three providers each building their own is how service.name splits across
New Relic dashboards (observability.md); the factory builds one and passes it
to every adapter. Pure and total: the "dev" when unset for the version is
resolved by the factory before this runs, never inside.
"""

from __future__ import annotations

from opentelemetry.sdk.resources import Resource


def build_resource(
    service_name: str, service_version: str, environment: str
) -> Resource:
    """service.name, service.version, and both deployment labels = the flick.

    The flick (dev/prod) lands on deployment.environment.name — the vocabulary
    the app and the docs ship — and on the legacy deployment.environment key
    the New Relic dashboards and alerts filter on. The stamping is done twice
    on purpose: without a collector in the path to upsert the label, direct
    pushes would otherwise be invisible to every board whose NRQL filters the
    legacy key.
    """
    return Resource.create(
        {
            "service.name": service_name,
            "service.version": service_version,
            "deployment.environment": environment,
            "deployment.environment.name": environment,
        }
    )
