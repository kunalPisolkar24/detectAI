"""The engine port: one method wide, and the raiser that hangs off the plane root."""

from app.inference.engine import Engine, EngineError, OnnxEngine
from app.inference.errors import InferenceError


def _engine() -> OnnxEngine:
    return OnnxEngine(
        session=object(),
        pad_token_id=50283,
        max_sequence_length=512,
        batch_size=8,
    )


def test_the_port_is_one_scoring_method_wide() -> None:
    assert Engine.__protocol_attrs__ == {"score"}


def test_the_adapter_satisfies_the_port_structurally() -> None:
    engine = _engine()

    assert callable(engine.score)


def test_the_warmup_lives_on_the_adapter_and_not_on_the_port() -> None:
    engine = _engine()

    assert callable(engine.warmup)
    assert "warmup" not in Engine.__protocol_attrs__


def test_engine_error_joins_the_plane_tree() -> None:
    assert issubclass(EngineError, InferenceError)
