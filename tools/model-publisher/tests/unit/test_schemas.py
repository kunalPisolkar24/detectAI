from __future__ import annotations

import pytest
from pydantic import ValidationError

from src.domain.schemas import ArtifactBundle, ModelMetadata


def test_metadata_valid() -> None:
    m = ModelMetadata(model_key="detect-ai-spark", version="v1.0.0", description="hello")
    assert m.model_key == "detect-ai-spark"
    assert m.version == "v1.0.0"


@pytest.mark.parametrize("version", ["1.0.0", "v1", "v1.0", "latest", "", "v1.0.0.0.0"])
def test_metadata_invalid_version(version: str) -> None:
    with pytest.raises(ValidationError):
        ModelMetadata(model_key="detect-ai-spark", version=version, description="x")


@pytest.mark.parametrize("version", ["v1.0.0", "v0.1.2-alpha", "v2.3.4+build.1", "v10.20.30"])
def test_metadata_valid_versions(version: str) -> None:
    m = ModelMetadata(model_key="detect-ai-spark", version=version, description="d")
    assert m.version == version


@pytest.mark.parametrize("key", ["", "INVALID_KEY", "a/b", "-bad", "a" * 65])
def test_metadata_invalid_model_key(key: str) -> None:
    with pytest.raises(ValidationError):
        ModelMetadata(model_key=key, version="v1.0.0", description="d")


def test_metadata_trims() -> None:
    m = ModelMetadata(model_key="  detect-ai-spark  ", version=" v1.0.0 ", description="  prod ")
    assert m.model_key == "detect-ai-spark"
    assert m.version == "v1.0.0"
    assert m.description == "prod"


def test_artifact_bundle_pure_no_exists_check(tmp_path) -> None:  # type: ignore[no-untyped-def]
    nonexistent = tmp_path / "does-not-exist-12345"
    # pure domain must NOT hit filesystem — should succeed even if path missing
    bundle = ArtifactBundle(
        metadata=ModelMetadata(model_key="detect-ai-spark", version="v1.0.0", description="d"),
        local_path=nonexistent,
    )
    assert bundle.local_path == nonexistent


def test_artifact_bundle_rejects_empty_path() -> None:
    with pytest.raises(ValidationError):
        ArtifactBundle(
            metadata=ModelMetadata(model_key="detect-ai-spark", version="v1.0.0", description="d"),
            local_path="",  # type: ignore[arg-type]
        )
