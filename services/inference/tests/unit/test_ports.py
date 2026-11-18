"""The ports the slices depend on: their shape is part of the architecture,
so a drift in one side of a seam fails here instead of at boot.
"""

from app.config import ConfigProvider, DevConfig, ProdConfig
from app.inference.preprocessing import FastTokenizer, Tokenizer
from app.models import ArtifactStore, LoadedModel, ModelLoader, OnnxModelLoader
from app.models.pulling import HuggingFaceStore
from app.observability import NullObservability, Observability, ObservabilityService


def test_the_config_provider_is_one_method_wide() -> None:
    assert ConfigProvider.__abstractmethods__ == frozenset({"get"})
    assert callable(DevConfig.get)
    assert callable(ProdConfig.get)


def test_the_tokenizer_port_carries_ids_and_offsets() -> None:
    assert Tokenizer.__protocol_attrs__ == {
        "cls_token_id",
        "sep_token_id",
        "pad_token_id",
        "special_token_count",
        "encode",
    }
    assert callable(FastTokenizer.encode)


def test_the_artifact_store_port_locates_then_pulls() -> None:
    assert ArtifactStore.__protocol_attrs__ == {"locate", "pull"}
    assert callable(HuggingFaceStore.locate)
    assert callable(HuggingFaceStore.pull)


def test_the_load_port_returns_named_models() -> None:
    assert ModelLoader.__protocol_attrs__ == {"load_all"}
    assert callable(OnnxModelLoader.load_all)
    assert set(LoadedModel.__dataclass_fields__) == {
        "key",
        "session",
        "tokenizer",
        "max_sequence_length",
        "providers",
    }


def test_the_observability_port_is_the_exception_safe_seam() -> None:
    assert Observability.__protocol_attrs__ == {
        "annotate_model",
        "mark_failed",
        "track_document",
        "track_batch",
        "record_engine_duration",
        "shutdown",
    }
    for realization in (NullObservability, ObservabilityService):
        for method in Observability.__protocol_attrs__:
            assert callable(getattr(realization, method))
