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
    """service.name, service.version, deployment.environment.name = the flick.

    The flick (dev/prod) is the deployment.environment.name vocabulary New
    Relic dashboards split on; the factory passes it through from settings.
    """
    return Resource.create(
        {
            "service.name": service_name,
            "service.version": service_version,
            "deployment.environment.name": environment,
        }
    )
