"""LogsAdapter: one LoggerProvider, an OTel handler over the root logger.

The stdout handler main.py's basicConfig keeps stays; this adds a
destination, and every record riding it carries its trace/span ids so New
Relic correlates logs with traces with no custom formatter (observability.md's
logs view). Uvicorn's loggers deliberately stay stdout-only — the request
spans already carry latency and status.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    # The OTel SDK imports move to runtime when the deps land (build phase).
    from opentelemetry.sdk._logs import LoggerProvider, LoggingHandler
    from opentelemetry.sdk._logs.export import LogRecordExporter
    from opentelemetry.sdk.resources import Resource


class LogsAdapter:
    """Starts once — the provider installs are global singletons, so a double
    start is a wiring bug and fails the boot loudly."""

    def __init__(self, log_exporter: LogRecordExporter) -> None:
        self._log_exporter = log_exporter
        self._provider: LoggerProvider | None = None
        self._handler: LoggingHandler | None = None

    def start(self, resource: Resource) -> None:
        """LoggerProvider(resource) plus a batch processor, and the
        LoggingHandler attached to the root logger."""
        raise NotImplementedError(
            "TODO(observability build): build the provider, arrive the handler, attach it to root"
        )

    def shutdown(self) -> None:
        """Detach the handler first, then force-flush — the final boot log
        line, queued before this runs, rides out with the records; idempotent."""
        raise NotImplementedError(
            "TODO(observability build): detach then flush, idempotent"
        )
