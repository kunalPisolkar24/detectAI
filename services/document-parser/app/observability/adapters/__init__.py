"""The three signal adapters — external-system integrations under adapters/.

The same rule app/config follows for its adapters (dotenv, SSM, Secrets
Manager): everything that touches an external system lives here. Each
adapter owns exactly one SDK provider, starts against the shared Resource,
and accepts its exporter injected — the test seam is constructor injection
(in-memory exporters), not interface substitution.
"""

from .logs import LogsAdapter
from .metrics import MetricsAdapter
from .traces import TracesAdapter

__all__ = ["LogsAdapter", "MetricsAdapter", "TracesAdapter"]
