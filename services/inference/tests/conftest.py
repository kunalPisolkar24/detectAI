import time
from unittest.mock import AsyncMock, MagicMock

import jwt
import pytest

import src.config as config_module
import src.server.grpc_server as grpc_server_module
import src.server.interceptors as interceptors_module
from src.config import Settings
from src.domain.models import DocumentScore


class AbortError(Exception):
    def __init__(self, code, details):
        super().__init__(details)
        self.code = code
        self.details = details


class FakeContext:
    def __init__(self, done=False):
        self._done = done
        self.aborts = []

    def done(self):
        return self._done

    def set_done(self, done):
        self._done = done

    async def abort(self, code, details):
        self.aborts.append((code, details))
        raise AbortError(code, details)


@pytest.fixture
def test_settings(monkeypatch, unused_tcp_port):
    settings = Settings(
        API_KEY="test-secret-key",
        GRPC_PORT=unused_tcp_port,
        BATCH_SIZE=2,
        BATCH_TIMEOUT=0.05,
        BATCH_QUEUE_MAX_SIZE=8,
        MAX_INFLIGHT_DOC_CHUNKS=2,
        MAX_TEXT_LENGTH=100,
        CHUNK_TOKEN_LIMIT=4,
        CHUNK_TOKEN_STRIDE=2,
        MAX_GLOBAL_TOKENS=100,
    )

    monkeypatch.setattr(config_module, "settings", settings)
    monkeypatch.setattr(interceptors_module, "settings", settings)
    monkeypatch.setattr(grpc_server_module, "settings", settings)
    return settings


@pytest.fixture
def auth_token(test_settings):
    return jwt.encode(
        {"sub": "test-user", "iat": int(time.time())},
        test_settings.API_KEY,
        algorithm="HS256",
    )


@pytest.fixture
def expired_auth_token(test_settings):
    return jwt.encode(
        {"sub": "test-user", "exp": int(time.time()) - 60},
        test_settings.API_KEY,
        algorithm="HS256",
    )


@pytest.fixture
def grpc_context():
    return FakeContext()


@pytest.fixture
def mock_analysis_service():
    service = MagicMock()
    service.engines = {"spark": object(), "flare": object()}
    service.analyze = AsyncMock(
        return_value=DocumentScore(ai_probability=0.8, total_chunks=1, total_chars=100)
    )
    service.shutdown = AsyncMock()
    return service
