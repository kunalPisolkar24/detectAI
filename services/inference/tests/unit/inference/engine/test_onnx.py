"""The ONNX Runtime adapter: the guards, the padding, the softmax, and the warmup."""

import numpy as np
import pytest

from app.inference.engine import EngineError, OnnxEngine

_PAD_TOKEN_ID = 50283
_MAX_SEQUENCE_LENGTH = 512
_BATCH_SIZE = 8

# The two-class softmax of a [0, 1] logit pair: the AI column wins.
_AI_PROBABILITY = 0.7310585786300049


class FakeSession:
    """Records the feed it was handed and returns a scripted logits array."""

    def __init__(
        self,
        logits: np.ndarray | None = None,
        error: Exception | None = None,
    ) -> None:
        self._logits = logits
        self._error = error
        self.shapes: list[tuple[tuple[int, ...], tuple[int, ...]]] = []
        self.feeds: list[dict[str, np.ndarray]] = []

    def run(self, output_names, feed):
        self.shapes.append((feed["input_ids"].shape, feed["attention_mask"].shape))
        self.feeds.append(feed)
        if self._error is not None:
            raise self._error
        if self._logits is not None:
            return [self._logits]
        width = feed["input_ids"].shape[0]
        return [np.tile(np.array([0.0, 1.0], dtype=np.float32), (width, 1))]


def _engine(session: FakeSession | None = None, **overrides: object) -> OnnxEngine:
    kwargs: dict[str, object] = {
        "session": session if session is not None else FakeSession(),
        "pad_token_id": _PAD_TOKEN_ID,
        "max_sequence_length": _MAX_SEQUENCE_LENGTH,
        "batch_size": _BATCH_SIZE,
    }
    kwargs.update(overrides)
    return OnnxEngine(**kwargs)  # type: ignore[arg-type]


def test_the_adapter_holds_its_explicit_contract() -> None:
    session = FakeSession()
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


def test_an_empty_call_scores_nothing_and_never_touches_the_session() -> None:
    session = FakeSession()

    assert _engine(session).score(()) == ()
    assert session.shapes == []


def test_the_padding_is_to_the_widest_sequence_with_the_pad_id_in_the_tail() -> None:
    session = FakeSession()

    _engine(session).score(((50281, 42, 50282), (50281, 43, 44, 50282)))

    feed = session.feeds[0]
    assert feed["input_ids"].shape == (2, 4)
    assert feed["input_ids"].dtype == np.int64
    assert feed["attention_mask"].dtype == np.int64
    assert feed["input_ids"][0].tolist() == [50281, 42, 50282, _PAD_TOKEN_ID]
    assert feed["input_ids"][1].tolist() == [50281, 43, 44, 50282]
    assert feed["attention_mask"][0].tolist() == [1, 1, 1, 0]
    assert feed["attention_mask"][1].tolist() == [1, 1, 1, 1]


def test_the_ai_probability_is_the_softmax_column_one() -> None:
    probabilities = _engine().score(((50281, 42, 50282),))

    assert probabilities[0] == pytest.approx(_AI_PROBABILITY)


def test_the_probabilities_come_back_in_the_order_the_sequences_were_handed_over() -> None:
    session = FakeSession(
        logits=np.array([[0.0, 1.0], [0.0, 0.0]], dtype=np.float32),
    )

    probabilities = _engine(session).score(((50281, 42, 50282), (50281, 43, 50282)))

    assert probabilities[0] == pytest.approx(_AI_PROBABILITY)
    assert probabilities[1] == pytest.approx(0.5)


def test_the_softmax_survives_a_large_margin() -> None:
    session = FakeSession(
        logits=np.array([[0.0, 1000.0]], dtype=np.float32),
    )

    probabilities = _engine(session).score(((50281, 42, 50282),))

    assert probabilities[0] == pytest.approx(1.0)


@pytest.mark.parametrize("shape", [(2, 1), (2, 3), (2,)])
def test_a_wrong_output_shape_is_an_engine_error(shape: tuple[int, ...]) -> None:
    session = FakeSession(logits=np.zeros(shape, dtype=np.float32))

    with pytest.raises(EngineError, match="the contract is"):
        _engine(session).score(((50281, 42, 50282), (50281, 43, 50282)))


@pytest.mark.parametrize("value", [np.nan, np.inf, -np.inf])
def test_non_finite_logits_are_an_engine_error(value: float) -> None:
    session = FakeSession(
        logits=np.array([[0.0, value]], dtype=np.float32),
    )

    with pytest.raises(EngineError, match="non-finite"):
        _engine(session).score(((50281, 42, 50282),))


def test_an_empty_sequence_is_an_engine_error() -> None:
    session = FakeSession()

    with pytest.raises(EngineError, match="is empty"):
        _engine(session).score(((),))

    assert session.shapes == []


def test_a_sequence_over_the_ceiling_is_refused_before_the_session_runs() -> None:
    session = FakeSession()
    too_long = (50281,) * (_MAX_SEQUENCE_LENGTH + 1)

    with pytest.raises(EngineError, match="the model's ceiling"):
        _engine(session).score((too_long,))

    assert session.shapes == []


def test_a_call_wider_than_the_batch_is_refused_before_the_session_runs() -> None:
    session = FakeSession()
    sequence = (50281, 42, 50282)

    with pytest.raises(EngineError, match="at most 8"):
        _engine(session).score(tuple([sequence] * (_BATCH_SIZE + 1)))

    assert session.shapes == []


def test_a_call_exactly_at_the_batch_size_is_accepted() -> None:
    session = FakeSession()
    sequence = (50281, 42, 50282)

    probabilities = _engine(session).score(tuple([sequence] * _BATCH_SIZE))

    assert len(probabilities) == _BATCH_SIZE
    assert session.shapes == [((_BATCH_SIZE, 3), (_BATCH_SIZE, 3))]


def test_a_failed_session_run_is_an_engine_error_wrapping_the_cause() -> None:
    session = FakeSession(error=RuntimeError("the graph is broken"))

    with pytest.raises(EngineError, match="the session run failed") as failure:
        _engine(session).score(((50281, 42, 50282),))

    assert isinstance(failure.value.__cause__, RuntimeError)


def test_the_warmup_probes_then_runs_the_production_shape() -> None:
    session = FakeSession()

    _engine(session).warmup(512)

    assert session.shapes == [((1, 8), (1, 8)), ((_BATCH_SIZE, 512), (_BATCH_SIZE, 512))]


def test_a_warmup_that_cannot_score_is_an_engine_error() -> None:
    session = FakeSession(error=RuntimeError("the graph is broken"))

    with pytest.raises(EngineError, match="the session run failed"):
        _engine(session).warmup(512)


def test_a_warmup_above_the_ceiling_is_an_engine_error() -> None:
    session = FakeSession()

    with pytest.raises(EngineError, match="the model's ceiling"):
        _engine(session).warmup(_MAX_SEQUENCE_LENGTH + 1)

    assert session.shapes == []


def test_a_warmup_below_one_token_is_an_engine_error() -> None:
    with pytest.raises(EngineError, match="at least one token"):
        _engine().warmup(0)
