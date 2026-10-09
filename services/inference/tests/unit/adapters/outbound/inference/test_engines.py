import pytest
from pytest import approx
import numpy as np
from unittest.mock import MagicMock
from src.adapters.outbound.inference.engines.spark import SparkEngine
from src.adapters.outbound.inference.engines.flare import FlareEngine
from src.domain.exceptions import InferenceError

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
    # Flat logits are passed through sigmoid and clipped to [0,1]
    def _sigmoid(x):  # type: ignore[no-untyped-def]
        import math

        return 1 / (1 + math.exp(-x))

    assert results == approx([_sigmoid(0.9), _sigmoid(0.1)])

def test_spark_engine_column_output(mock_onnx_session):
    tokenizer = MockTokenizer()
    engine = SparkEngine((mock_onnx_session, tokenizer))

    mock_onnx_session.run.return_value = [np.array([[0.9], [0.1]], dtype=np.float32)]

    results = engine.predict_batch(["text1", "text2"])
    def _sigmoid(x):  # type: ignore[no-untyped-def]
        import math

        return 1 / (1 + math.exp(-x))

    assert results == approx([_sigmoid(0.9), _sigmoid(0.1)])

def test_spark_engine_single_item_batch(mock_onnx_session):
    tokenizer = MockTokenizer()
    engine = SparkEngine((mock_onnx_session, tokenizer))
    mock_onnx_session.run.return_value = [np.array([0.7], dtype=np.float32)]

    results = engine.predict_batch(["text"])
    import math

    assert results == approx([1 / (1 + math.exp(-0.7))])

def test_spark_engine_failure(mock_onnx_session):
    tokenizer = MockTokenizer()
    engine = SparkEngine((mock_onnx_session, tokenizer))
    mock_onnx_session.run.side_effect = Exception("ONNX Error")
    
    with pytest.raises(InferenceError) as exc:
        engine.predict_batch(["text"])
    assert "Spark batch inference failed" in str(exc.value)

def test_flare_engine_success(mock_onnx_session):
    tokenizer = MockTokenizer()
    engine = FlareEngine((mock_onnx_session, tokenizer))
    mock_onnx_session.run.return_value = [np.array([[-2.0, 2.0]], dtype=np.float32)]
    
    results = engine.predict_batch(["text"])
    assert len(results) == 1
    assert 0.9 < results[0] < 1.0 

def test_flare_engine_failure(mock_onnx_session):
    tokenizer = MagicMock()
    tokenizer.side_effect = Exception("Tokenization Error")
    
    engine = FlareEngine((mock_onnx_session, tokenizer))
    
    with pytest.raises(InferenceError) as exc:
        engine.predict_batch(["text"])
    assert "Flare batch inference failed" in str(exc.value)

def test_spark_engine_warmup_uses_session_feature_dim(mock_onnx_session):
    shape_mock = MagicMock()
    shape_mock.name = "input_1"
    shape_mock.shape = ["batch", 7]
    mock_onnx_session.get_inputs.return_value = [shape_mock]
    engine = SparkEngine((mock_onnx_session, MockTokenizer()))

    engine.warmup()

    args, _ = mock_onnx_session.run.call_args
    assert args[0] is None
    import numpy as np

    arr = args[1]["input_1"]
    assert isinstance(arr, np.ndarray) and arr.shape == (1, 7)

def test_spark_engine_warmup_falls_back_to_tokenizer_vocab(mock_onnx_session):
    shape_mock = MagicMock()
    shape_mock.name = "input_1"
    shape_mock.shape = ["batch", None]
    mock_onnx_session.get_inputs.return_value = [shape_mock]
    tokenizer = MockTokenizer()
    tokenizer.vocabulary_ = {"a": 0, "b": 1, "c": 2}
    engine = SparkEngine((mock_onnx_session, tokenizer))

    engine.warmup()

    args, _ = mock_onnx_session.run.call_args
    arr = args[1]["input_1"]
    assert arr.shape == (1, 3)

def test_flare_engine_warmup_runs_session(mock_onnx_session):
    engine = FlareEngine((mock_onnx_session, MockTokenizer()))

    engine.warmup()

    mock_onnx_session.run.assert_called_once()
    feed = mock_onnx_session.run.call_args.args[1]
    assert set(feed) <= {"input_ids", "attention_mask", "input_1"}

def test_spark_engine_feeds_float32_dense_from_float64_sparse(mock_onnx_session):
    from scipy.sparse import csr_matrix

    captured = {}

    class SparseTokenizer:
        def transform(self, texts):
            return csr_matrix(np.array([[0.0, 1.5, 0.0], [2.5, 0.0, 0.0]], dtype=np.float64))

    def fake_run(output_names, feed):
        captured.update(feed)
        return [np.array([[0.2, 0.8], [0.7, 0.3]], dtype=np.float32)]

    mock_onnx_session.run.side_effect = fake_run
    engine = SparkEngine((mock_onnx_session, SparseTokenizer()))

    results = engine.predict_batch(["a b", "c"])

    assert len(results) == 2
    vectorized = captured["input_1"]
    assert vectorized.dtype == np.float32
    np.testing.assert_allclose(vectorized, [[0.0, 1.5, 0.0], [2.5, 0.0, 0.0]], rtol=0, atol=1e-6)

def test_flare_engine_reuses_int64_inputs_without_copy():
    session = MagicMock()
    names = []
    for name in ("input_ids", "attention_mask"):
        node = MagicMock()
        node.name = name
        names.append(node)
    session.get_inputs.return_value = names
    captured = {}

    class IdentityTokenizer:
        def __init__(self):
            self.last = None

        def __call__(self, texts, return_tensors=None, padding=True, truncation=True, max_length=None):
            self.last = {
                "input_ids": np.ones((len(texts), 4), dtype=np.int64),
                "attention_mask": np.ones((len(texts), 4), dtype=np.int64),
            }
            return self.last

    def fake_run(output_names, feed):
        captured.update(feed)
        return [np.array([[0.3, 0.7]], dtype=np.float32)]

    session.run.side_effect = fake_run
    tokenizer = IdentityTokenizer()
    engine = FlareEngine((session, tokenizer))

    results = engine.predict_batch(["text"])

    assert results == approx([0.5987], abs=1e-4)
    assert captured["input_ids"] is tokenizer.last["input_ids"]
    assert captured["attention_mask"] is tokenizer.last["attention_mask"]
