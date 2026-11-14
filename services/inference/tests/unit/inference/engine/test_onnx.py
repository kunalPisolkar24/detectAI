"""The ONNX Runtime adapter: the constructor holds its contract, the calls are pending."""

import pytest

from app.inference.engine import OnnxEngine


def _engine(**overrides: object) -> OnnxEngine:
    kwargs: dict[str, object] = {
        "session": object(),
        "pad_token_id": 50283,
        "max_sequence_length": 512,
        "batch_size": 8,
    }
    kwargs.update(overrides)
    return OnnxEngine(**kwargs)  # type: ignore[arg-type]


def test_a_score_request_is_pending() -> None:
    with pytest.raises(NotImplementedError):
        _engine().score(((50281, 42, 50282),))


def test_a_warmup_request_is_pending() -> None:
    with pytest.raises(NotImplementedError):
        _engine().warmup()


def test_a_padding_request_is_pending() -> None:
    with pytest.raises(NotImplementedError):
        _engine()._pad(((50281, 42, 50282),))


def test_a_softmax_request_is_pending() -> None:
    with pytest.raises(NotImplementedError):
        _engine()._probability(object())  # type: ignore[arg-type]


def test_the_adapter_holds_its_explicit_contract() -> None:
    session = object()
    engine = _engine(
        session=session,
        pad_token_id=0,
        max_sequence_length=8192,
        batch_size=32,
    )

    assert engine._session is session
    assert engine._pad_token_id == 0
    assert engine._max_sequence_length == 8192
    assert engine._batch_size == 32
