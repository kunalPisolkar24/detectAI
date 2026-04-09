import json
import logging

from src.log_setup import configure_logger


def test_configure_logger_formats_foreign_records():
    root_logger = logging.getLogger()
    original_handlers = list(root_logger.handlers)
    original_level = root_logger.level

    try:
        configure_logger()

        handler = root_logger.handlers[0]
        record = logging.LogRecord(
            name="asyncio",
            level=logging.ERROR,
            pathname=__file__,
            lineno=1,
            msg="Future exception was never retrieved",
            args=(),
            exc_info=None,
        )

        payload = json.loads(handler.format(record))

        assert payload["event"] == "Future exception was never retrieved"
        assert payload["logger"] == "asyncio"
        assert payload["level"] == "error"
        assert "timestamp" in payload
    finally:
        root_logger.handlers.clear()
        for original_handler in original_handlers:
            root_logger.addHandler(original_handler)
        root_logger.setLevel(original_level)
