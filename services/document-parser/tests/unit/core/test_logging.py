import asyncio
import json
import logging
from unittest.mock import MagicMock

from app.core.logging import JsonFormatter, log_request_middleware


def _record(msg="Request processed", extra=None):
    logger = logging.getLogger("file_service")
    return logger.makeRecord(
        logger.name,
        logging.INFO,
        __file__,
        1,
        msg,
        (),
        None,
        extra=extra,
    )


def test_json_formatter_emits_core_fields():
    payload = json.loads(JsonFormatter().format(_record("hello")))

    assert payload["message"] == "hello"
    assert payload["level"] == "INFO"
    assert payload["module"] == __name__.rsplit(".", 1)[0].rsplit(".", 1)[-1] or payload["module"]
    assert "timestamp" in payload


def test_json_formatter_merges_request_meta():
    meta = {"method": "POST", "path": "/extract", "status_code": 200}
    record = _record(extra={"request_meta": meta})

    payload = json.loads(JsonFormatter().format(record))

    for key, value in meta.items():
        assert payload[key] == value


def test_formatter_output_is_single_line_json():
    formatted = JsonFormatter().format(_record("line one\nline two"))
    assert "\n" not in formatted.strip()
    json.loads(formatted)


def test_log_request_middleware_records_meta(caplog):
    request = MagicMock()
    request.method = "GET"
    request.url.path = "/health"
    response = MagicMock()
    response.status_code = 200

    async def call_next(_):
        return response

    with caplog.at_level(logging.INFO, logger="file_service"):
        asyncio.run(log_request_middleware(request, call_next))

    meta = caplog.records[0].request_meta
    assert meta["method"] == "GET"
    assert meta["path"] == "/health"
    assert meta["status_code"] == 200
    assert isinstance(meta["duration_ms"], float)
    assert meta["trace_id"] == "-"


def test_log_request_middleware_propagates_response():
    request = MagicMock()
    request.url.path = "/x"
    sentinel = MagicMock()
    sentinel.status_code = 201

    async def call_next(_):
        return sentinel

    result = asyncio.run(log_request_middleware(request, call_next))
    assert result is sentinel
