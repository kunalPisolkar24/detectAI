import pytest
from unittest.mock import MagicMock, patch
from src.inference.loader import HuggingFaceLoader
from src.core.exceptions import ModelLoadError

@pytest.fixture
def mock_loader_env(tmp_path):
    with patch("src.inference.loader.ort.InferenceSession") as mock_session, \
         patch("src.inference.loader.pickle.load") as mock_pickle, \
         patch("src.inference.loader.hf_hub_download") as mock_dl, \
         patch("src.inference.loader.snapshot_download") as mock_snap, \
         patch("src.inference.loader.BertTokenizer.from_pretrained") as mock_tok:
        
        mock_session.return_value = MagicMock()
        mock_pickle.return_value = MagicMock()
        mock_tok.return_value = MagicMock()
        mock_dl.return_value = str(tmp_path / "model.onnx")
        mock_snap.return_value = str(tmp_path / "flare_dir")
        
        with open(tmp_path / "model.onnx", "w") as f:
            f.write("dummy")
            
        yield mock_session, mock_pickle, mock_dl, mock_snap

def test_load_spark(mock_loader_env):
    mock_session, mock_pickle, mock_dl, _ = mock_loader_env
    loader = HuggingFaceLoader("./cache")
    
    session, tokenizer = loader.load("spark")
    
    assert mock_dl.call_count == 2
    mock_session.assert_called_once()
    mock_pickle.assert_called_once()

def test_load_flare(mock_loader_env):
    _, _, _, mock_snap = mock_loader_env
    loader = HuggingFaceLoader("./cache")
    
    session, tokenizer = loader.load("flare")
    
    mock_snap.assert_called_once()

def test_load_unknown_key():
    loader = HuggingFaceLoader("./cache")
    with pytest.raises(ModelLoadError) as exc:
        loader.load("invalid_key")
    assert "Unknown model key" in str(exc.value)

def test_load_runtime_error(mock_loader_env):
    _, _, mock_dl, _ = mock_loader_env
    mock_dl.side_effect = Exception("Network Error")
    
    loader = HuggingFaceLoader("./cache")
    with pytest.raises(ModelLoadError) as exc:
        loader.load("spark")
    assert "Network Error" in str(exc.value)