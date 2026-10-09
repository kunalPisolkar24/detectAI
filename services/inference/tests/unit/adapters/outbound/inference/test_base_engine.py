import numpy as np
import pytest

from src.adapters.outbound.inference.engines.base import BaseEngine
from src.domain.exceptions import InferenceError


@pytest.fixture
def engine():
    return BaseEngine()


def _softmax_f64(x):
    x = np.asarray(x, dtype=np.float64)
    shifted = np.clip(x - np.max(x, axis=-1, keepdims=True), -50, 50)
    e_x = np.exp(shifted)
    return e_x / e_x.sum(axis=-1, keepdims=True)


def _sigmoid_f64(x):
    x = np.asarray(x, dtype=np.float64)
    return 1 / (1 + np.exp(-np.clip(x, -30, 30)))


def test_softmax_matches_float64_reference(engine):
    rng = np.random.default_rng(42)
    logits = rng.uniform(-8, 8, size=(16, 2)).astype(np.float32)

    np.testing.assert_allclose(engine.softmax(logits), _softmax_f64(logits), rtol=1e-6, atol=1e-7)


def test_sigmoid_matches_float64_reference(engine):
    rng = np.random.default_rng(7)
    logits = rng.uniform(-10, 10, size=64).astype(np.float32)

    np.testing.assert_allclose(engine.sigmoid(logits), _sigmoid_f64(logits), rtol=1e-6, atol=1e-7)


def test_softmax_stays_float32(engine):
    out = engine.softmax(np.array([[1.0, 2.0]], dtype=np.float32))

    assert out.dtype == np.float32


def test_softmax_rejects_empty_and_non_finite(engine):
    with pytest.raises(InferenceError):
        engine.softmax(np.array([], dtype=np.float32))
    with pytest.raises(InferenceError):
        engine.softmax(np.array([[1.0, float("inf")]], dtype=np.float32))


def test_decode_logits_shapes(engine):
    assert engine.decode_logits(np.array([0.0], dtype=np.float32)) == pytest.approx([0.5])
    assert engine.decode_logits(np.array([[10.0]], dtype=np.float32))[0] == pytest.approx(1.0, abs=1e-4)
    two_class = engine.decode_logits(np.array([[0.1, 0.9]], dtype=np.float32))
    assert two_class[0] > 0.5
    with pytest.raises(InferenceError):
        engine.decode_logits(np.zeros((2, 3), dtype=np.float32))
