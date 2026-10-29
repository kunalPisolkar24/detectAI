"""The three signal adapters: external-system integrations live here, exporters injected."""

from .logs import LogsAdapter
from .metrics import MetricsAdapter
from .traces import TracesAdapter

__all__ = ["LogsAdapter", "MetricsAdapter", "TracesAdapter"]
