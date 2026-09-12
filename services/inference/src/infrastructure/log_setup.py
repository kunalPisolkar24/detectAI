import logging
import os
import sys

import structlog


_ALLOWED_LEVELS = {"DEBUG", "INFO", "WARNING", "WARN", "ERROR", "CRITICAL"}


def _resolve_log_level(level: str | None = None) -> int:
    """Resolve log level from explicit ``level`` or ``LOG_LEVEL`` env (validated)."""
    raw = level if level is not None else os.getenv("LOG_LEVEL", "INFO")
    normalized = str(raw).strip().upper()
    if normalized == "WARN":
        normalized = "WARNING"
    if normalized not in _ALLOWED_LEVELS:
        structlog.get_logger().warning("invalid_log_level_fallback", level=raw, fallback="INFO")
        normalized = "INFO"
    return getattr(logging, normalized, logging.INFO)


def configure_logger(level: str | None = None) -> None:
    log_level = _resolve_log_level(level)

    timestamper = structlog.processors.TimeStamper(fmt="iso")
    structlog_processors: list = [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.filter_by_level,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        timestamper,
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
        structlog.processors.UnicodeDecoder(),
    ]
    foreign_processors: list = [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        timestamper,
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
    ]

    structlog.configure(
        processors=structlog_processors + [
            structlog.stdlib.ProcessorFormatter.wrap_for_formatter,
        ],
        context_class=dict,
        logger_factory=structlog.stdlib.LoggerFactory(),
        wrapper_class=structlog.stdlib.BoundLogger,
        cache_logger_on_first_use=False,
    )

    formatter = structlog.stdlib.ProcessorFormatter(
        processor=structlog.processors.JSONRenderer(),
        foreign_pre_chain=foreign_processors,
    )

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(formatter)

    root_logger = logging.getLogger()
    # Ensure the JSON handler is available and first, while preserving non-stream handlers (e.g., pytest caplog)
    existing_json_handler = next(
        (
            h
            for h in root_logger.handlers
            if isinstance(getattr(h, "formatter", None), structlog.stdlib.ProcessorFormatter)
        ),
        None,
    )
    if existing_json_handler is None:
        # Remove existing plain StreamHandlers (keep caplog/other handlers)
        for h in list(root_logger.handlers):
            if isinstance(h, logging.StreamHandler) and not isinstance(
                getattr(h, "formatter", None), structlog.stdlib.ProcessorFormatter
            ):
                root_logger.removeHandler(h)
        # Insert JSON handler at front so handlers[0] is always the JSON formatter (test expectation)
        root_logger.handlers.insert(0, handler)
    else:
        # Update existing handler's formatter to pick up new processors/level
        existing_json_handler.setFormatter(formatter)
        handler = existing_json_handler
    # Ensure handler level tracks root level
    for h in root_logger.handlers:
        h.setLevel(log_level)
    root_logger.setLevel(log_level)
