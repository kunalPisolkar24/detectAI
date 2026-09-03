import pytest
from unittest.mock import MagicMock, patch
from src.adapters.outbound.inference.loader import HuggingFaceLoader
from src.domain.exceptions import ModelLoadError

@pytest.fixture
def mock_loader_env(tmp_path):
    with patch("src.adapters.outbound.inference.loader.ort.InferenceSession") as mock_session, \
         patch("src.adapters.outbound.inference.loader.RestrictedUnpickler") as mock_unpickler, \
         patch("src.adapters.outbound.inference.loader.hf_hub_download") as mock_dl, \
         patch("src.adapters.outbound.inference.loader.snapshot_download") as mock_snap, \
         patch("src.adapters.outbound.inference.loader.time.sleep"), \
         patch("src.adapters.outbound.inference.loader.BertTokenizerFast.from_pretrained") as mock_tok:

        mock_session.return_value = MagicMock()
        mock_instance = MagicMock()
        mock_instance.load.return_value = MagicMock()
        mock_unpickler.return_value = mock_instance
        mock_tok.return_value = MagicMock()
        mock_dl.return_value = str(tmp_path / "model.onnx")
        mock_snap.return_value = str(tmp_path / "flare_dir")

        with open(tmp_path / "model.onnx", "w") as f:
            f.write("dummy")

        yield mock_session, mock_unpickler, mock_dl, mock_snap

def test_load_spark(mock_loader_env):
    mock_session, mock_unpickler, mock_dl, _ = mock_loader_env
    loader = HuggingFaceLoader("./cache")

    session, tokenizer = loader.load("spark")

    assert mock_dl.call_count == 2
    mock_session.assert_called_once()
    mock_unpickler.assert_called_once()

def test_load_flare(mock_loader_env):
    _, _, _, mock_snap = mock_loader_env
    loader = HuggingFaceLoader("./cache")
    
    session, tokenizer = loader.load("flare")
    
    mock_snap.assert_called_once()

def test_load_unknown_key():
    loader = HuggingFaceLoader("./cache")
    with pytest.raises(ValueError, match="Unknown model key"):
        loader.load("invalid_key")

def test_load_runtime_error(mock_loader_env):
    _, _, mock_dl, _ = mock_loader_env
    mock_dl.side_effect = Exception("Network Error")
    
    loader = HuggingFaceLoader("./cache")
    with pytest.raises(ModelLoadError) as exc:
        loader.load("spark")
    assert "Network Error" in str(exc.value)


def test_loader_parses_json_provider_env(mock_loader_env, monkeypatch):
    mock_session, _, _, _ = mock_loader_env
    monkeypatch.setenv("INFERENCE_PROVIDERS", '["CPUExecutionProvider"]')

    loader = HuggingFaceLoader("./cache")
    loader.load("spark")

    assert mock_session.call_args.kwargs["providers"] == ["CPUExecutionProvider"]


def test_loader_warns_on_gpu_fallback(mock_loader_env, monkeypatch, mocker):
    mock_session_class, _, _, _ = mock_loader_env
    mock_session = mock_session_class.return_value
    mock_session.get_providers.return_value = ["CPUExecutionProvider"]
    
    # Force GPU request
    monkeypatch.setenv("INFERENCE_PROVIDERS", "CUDAExecutionProvider,CPUExecutionProvider")
    
    mock_logger = mocker.patch("src.adapters.outbound.inference.loader.logger")
    
    loader = HuggingFaceLoader("./cache")
    loader.load("spark")
    
    mock_logger.warning.assert_called_once_with(
        "gpu_provider_unavailable_falling_back_to_cpu",
        model="spark",
        repo_id="kpisolkar24/detect-ai-spark",
        revision="9a48004391c71272d6fb1d164ed7c56e1fbfe360",
        requested=["CUDAExecutionProvider", "CPUExecutionProvider"],
        active=["CPUExecutionProvider"]
    )


def test_loader_logs_model_identity(mock_loader_env, mocker):
    mock_session_class, _, _, _ = mock_loader_env
    mock_session = mock_session_class.return_value
    mock_session.get_providers.return_value = ["CPUExecutionProvider"]
    mock_logger = mocker.patch("src.adapters.outbound.inference.loader.logger")

    loader = HuggingFaceLoader("./cache", providers=["CPUExecutionProvider"])
    loader.load("spark")

    mock_logger.info.assert_any_call(
        "model_download_started",
        model="spark",
        repo_id="kpisolkar24/detect-ai-spark",
        revision="9a48004391c71272d6fb1d164ed7c56e1fbfe360",
        requested_providers=["CPUExecutionProvider"],
    )
    mock_logger.info.assert_any_call(
        "model_loaded",
        model="spark",
        repo_id="kpisolkar24/detect-ai-spark",
        revision="9a48004391c71272d6fb1d164ed7c56e1fbfe360",
        requested_providers=["CPUExecutionProvider"],
        active_providers=["CPUExecutionProvider"],
    )


def test_loader_passes_pinned_revisions(mock_loader_env):
    _, _, mock_dl, mock_snap = mock_loader_env
    loader = HuggingFaceLoader(
        "./cache",
        spark_model_revision="spark-rev",
        flare_model_revision="flare-rev",
    )

    loader.load("spark")
    loader.load("flare")

    assert mock_dl.call_args_list[0].kwargs["revision"] == "spark-rev"
    assert mock_dl.call_args_list[1].kwargs["revision"] == "spark-rev"
    assert mock_snap.call_args.kwargs["revision"] == "flare-rev"
