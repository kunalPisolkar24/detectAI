"""LogsAdapter: one LoggerProvider, an OTel handler over the root logger.

The stdout handler main.py's basicConfig keeps stays; this adds a
destination, and every record riding it carries its trace/span ids so New
Relic correlates logs with traces with no custom formatter (observability.md's
logs view). Uvicorn's loggers deliberately stay stdout-only — the request
spans already carry latency and status.
"""

import logging

from opentelemetry.sdk._logs import LoggerProvider, LoggingHandler
from opentelemetry.sdk._logs.export import (
    BatchLogRecordProcessor,
    LogRecordExporter,
)
from opentelemetry.sdk.resources import Resource

# Per-flush cap: the three drain flushes must fit the 12 s graceful window.
_FLUSH_TIMEOUT_MILLIS = 5_000

_UVICORN_LOGGERS = ("uvicorn", "uvicorn.error", "uvicorn.access")


class LogsAdapter:
    """Starts once — the provider installs are global singletons, so a double
    start is a wiring bug and fails the boot loudly."""

    def __init__(self, log_exporter: LogRecordExporter) -> None:
        self._log_exporter = log_exporter
        self._provider: LoggerProvider | None = None
        self._handler: LoggingHandler | None = None

    def start(self, resource: Resource) -> None:
        """A batch-processed provider whose handler rides the root logger —
        the root's INFO level stays the gate for what it sees."""
        if self._provider is not None:
            raise RuntimeError("LogsAdapter already started")
        provider = LoggerProvider(resource=resource)
        provider.add_log_record_processor(
            BatchLogRecordProcessor(
                self._log_exporter, export_timeout_millis=_FLUSH_TIMEOUT_MILLIS
            )
        )
        handler = LoggingHandler(logger_provider=provider)
        logging.getLogger().addHandler(handler)
        for name in _UVICORN_LOGGERS:
            logging.getLogger(name).propagate = False
        self._provider = provider
        self._handler = handler

    def shutdown(self) -> None:
        """Detach the handler first, then flush — the final boot log line,
        queued before this runs, rides out with the records; idempotent."""
        if self._provider is None:
            return
        logging.getLogger().removeHandler(self._handler)
        provider = self._provider
        self._provider = None
        self._handler = None
        provider.force_flush(timeout_millis=_FLUSH_TIMEOUT_MILLIS)
