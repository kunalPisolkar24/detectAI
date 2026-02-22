import pytest
from unittest.mock import MagicMock
import grpc
from src.core.interfaces import IInferenceEngine
from src.config import Settings

@pytest.fixture
def mock_settings(mocker):
    settings = Settings(
        API_KEY="test-secret-key",
        BATCH_SIZE=2,
        BATCH_TIMEOUT=0.1,
        MAX_TEXT_LENGTH=100
    )
    mocker.patch("src.config.settings", settings)
    mocker.patch("src.server.interceptors.settings", settings)
    mocker.patch("src.server.servicers.settings", settings)
    return settings

@pytest.fixture
def mock_engine():
    engine = MagicMock(spec=IInferenceEngine)
    engine.predict.return_value = 0.8
    engine.predict_batch.return_value = [0.8, 0.2]
    return engine

@pytest.fixture
def grpc_context():
    context = MagicMock(spec=grpc.ServicerContext)
    context.abort = MagicMock()
    return context