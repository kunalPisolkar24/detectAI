import pytest
from pytest import approx
import numpy as np
from unittest.mock import MagicMock
from src.inference.engines.spark import SparkEngine
from src.inference.engines.flare import FlareEngine
from src.core.exceptions import InferenceError

class MockTokenizer:
    def __init__(self, return_tensors="np"):
        self.return_tensors = return_tensors
    
    def transform(self, texts):
        mock_csr = MagicMock()
        mock_csr.toarray.return_value = np.zeros((len(texts), 10), dtype=np.float32)
        return mock_csr

    def __call__(self, texts, return_tensors=None, padding=True, truncation=True, max_length=None):
        return {
            "input_ids": np.ones((len(texts), 10), dtype=np.int64),
            "attention_mask": np.ones((len(texts), 10), dtype=np.int64)
        }

@pytest.fixture
def mock_onnx_session():
    session = MagicMock()
    input_mock = MagicMock()
    input_mock.name = "input_1"
    session.get_inputs.return_value = [input_mock]
    return session

def test_spark_engine_binary_prob(mock_onnx_session):
    tokenizer = MockTokenizer()
    engine = SparkEngine((mock_onnx_session, tokenizer))
    
    mock_onnx_session.run.return_value = [np.array([[0.1, 0.9], [0.8, 0.2]], dtype=np.float32)]
    
    results = engine.predict_batch(["text1", "text2"])
    
    assert len(results) == 2
    assert results[0] > 0.5 
    assert results[1] < 0.5 

def test_spark_engine_flat_output(mock_onnx_session):
    tokenizer = MockTokenizer()
    engine = SparkEngine((mock_onnx_session, tokenizer))
    
    mock_onnx_session.run.return_value = [np.array([0.9, 0.1], dtype=np.float32)]
    
    results = engine.predict_batch(["text1", "text2"])
    assert results == approx([0.9, 0.1])

def test_spark_engine_column_output(mock_onnx_session):
    tokenizer = MockTokenizer()
    engine = SparkEngine((mock_onnx_session, tokenizer))
    
    mock_onnx_session.run.return_value = [np.array([[0.9], [0.1]], dtype=np.float32)]
    
    results = engine.predict_batch(["text1", "text2"])
    assert results == approx([0.9, 0.1])

def test_spark_engine_single_predict(mock_onnx_session):
    tokenizer = MockTokenizer()
    engine = SparkEngine((mock_onnx_session, tokenizer))
    mock_onnx_session.run.return_value = [np.array([0.7], dtype=np.float32)]
    
    result = engine.predict("text")
    assert result == approx(0.7)

def test_spark_engine_failure(mock_onnx_session):
    tokenizer = MockTokenizer()
    engine = SparkEngine((mock_onnx_session, tokenizer))
    mock_onnx_session.run.side_effect = Exception("ONNX Error")
    
    with pytest.raises(InferenceError) as exc:
        engine.predict("text")
    assert "Spark batch inference failed" in str(exc.value)

def test_flare_engine_success(mock_onnx_session):
    tokenizer = MockTokenizer()
    engine = FlareEngine((mock_onnx_session, tokenizer))
    mock_onnx_session.run.return_value = [np.array([[-2.0, 2.0]], dtype=np.float32)]
    
    result = engine.predict("text")
    assert isinstance(result, float)
    assert 0.9 < result < 1.0 

def test_flare_engine_failure(mock_onnx_session):
    tokenizer = MagicMock()
    tokenizer.side_effect = Exception("Tokenization Error")
    
    engine = FlareEngine((mock_onnx_session, tokenizer))
    
    with pytest.raises(InferenceError) as exc:
        engine.predict("text")
    assert "Flare batch inference failed" in str(exc.value)