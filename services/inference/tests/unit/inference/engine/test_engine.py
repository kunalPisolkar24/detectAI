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


def test_the_port_is_scoring_and_warmup_wide() -> None:
    # The runtime holds the port, so the warmup it owns has to be on it.
    assert Engine.__protocol_attrs__ == {"score", "warmup"}


def test_the_adapter_satisfies_the_port_structurally() -> None:
    engine = _engine()

    assert callable(engine.score)
    assert callable(engine.warmup)


def test_engine_error_joins_the_plane_tree() -> None:
    assert issubclass(EngineError, InferenceError)
