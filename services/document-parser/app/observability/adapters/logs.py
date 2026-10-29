"""Logs adapter: one LoggerProvider over the root logger; uvicorn's loggers stay stdout-only."""

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
        self._processor: BatchLogRecordProcessor | None = None

    def start(self, resource: Resource) -> None:
        if self._provider is not None:
            raise RuntimeError("LogsAdapter already started")
        provider = LoggerProvider(resource=resource)
        processor = BatchLogRecordProcessor(
            self._log_exporter, export_timeout_millis=_FLUSH_TIMEOUT_MILLIS
        )
        provider.add_log_record_processor(processor)
        handler = LoggingHandler(logger_provider=provider)
        logging.getLogger().addHandler(handler)
        for name in _UVICORN_LOGGERS:
            logging.getLogger(name).propagate = False
        self._processor = processor
        self._provider = provider
        self._handler = handler

    def shutdown(self) -> None:
        """Detach the handler, flush, then stop the worker; idempotent."""
        if self._provider is None:
            return
        logging.getLogger().removeHandler(self._handler)
        provider = self._provider
        processor = self._processor
        self._provider = None
        self._processor = None
        self._handler = None
        try:
            provider.force_flush(timeout_millis=_FLUSH_TIMEOUT_MILLIS)
        finally:
            processor.shutdown()
