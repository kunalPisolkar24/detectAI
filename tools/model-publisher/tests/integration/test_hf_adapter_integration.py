from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock

import pytest

from src.core.exceptions import TagFailedException, UploadFailedException
from src.domain.schemas import ArtifactBundle, ModelMetadata
from src.infrastructure.huggingface.registry import HuggingFaceRegistry


def _bundle(tmp_path: Path, model: str = "detect-ai-spark", version: str = "v1.0.0") -> ArtifactBundle:
    return ArtifactBundle(
        metadata=ModelMetadata(model_key=model, version=version, description="Production release v1.0.0"),
        local_path=tmp_path / "assets" / model,
    )


@pytest.mark.integration
def test_hf_upload_calls_api_with_correct_args(tmp_path: Path) -> None:
    (tmp_path / "assets" / "detect-ai-spark").mkdir(parents=True)
    bundle = _bundle(tmp_path)
    api = MagicMock()
    api.upload_folder.return_value = "https://huggingface.co/user/detect-ai-spark/tree/v1.0.0"
    reg = HuggingFaceRegistry(api=api, username="myuser")

    url = reg.upload_artifacts(bundle)

    assert url.startswith("https://")
    api.upload_folder.assert_called_once()
    kwargs = api.upload_folder.call_args.kwargs
    assert kwargs["repo_id"] == "myuser/detect-ai-spark"
    assert kwargs["repo_type"] == "model"
    assert "v1.0.0" in kwargs["commit_message"]
    assert kwargs["folder_path"] == str(bundle.local_path)


@pytest.mark.integration
def test_hf_upload_wraps_exception_with_redaction(tmp_path: Path) -> None:
    (tmp_path / "assets" / "detect-ai-spark").mkdir(parents=True)
    bundle = _bundle(tmp_path)
    api = MagicMock()
    api.upload_folder.side_effect = RuntimeError("network down")
    reg = HuggingFaceRegistry(api=api, username="myuser")

    with pytest.raises(UploadFailedException) as ei:
        reg.upload_artifacts(bundle)
    assert ei.value.repo_id == "myuser/detect-ai-spark"
    assert "myuser/detect-ai-spark" in str(ei.value)


@pytest.mark.integration
def test_hf_upload_redacts_token_in_message(tmp_path: Path) -> None:
    (tmp_path / "assets" / "detect-ai-spark").mkdir(parents=True)
    bundle = _bundle(tmp_path)
    api = MagicMock()
    api.upload_folder.side_effect = RuntimeError("Invalid token hf_abc123")
    reg = HuggingFaceRegistry(api=api, username="myuser")

    with pytest.raises(UploadFailedException) as ei:
        reg.upload_artifacts(bundle)
    # should be redacted when error mentions token
    assert "redacted" in str(ei.value).lower()


@pytest.mark.integration
def test_hf_create_tag_calls_api(tmp_path: Path) -> None:
    (tmp_path / "assets" / "detect-ai-spark").mkdir(parents=True)
    bundle = _bundle(tmp_path, version="v2.0.0")
    api = MagicMock()
    reg = HuggingFaceRegistry(api=api, username="myuser")

    reg.set_version_tag(bundle)

    api.create_tag.assert_called_once_with(
        repo_id="myuser/detect-ai-spark", tag="v2.0.0", tag_message="Production release v1.0.0"
    )


@pytest.mark.integration
def test_hf_create_tag_maps_already_exists_to_tag_failed(tmp_path: Path) -> None:
    (tmp_path / "assets" / "detect-ai-spark").mkdir(parents=True)
    bundle = _bundle(tmp_path)
    api = MagicMock()
    api.create_tag.side_effect = RuntimeError("Tag already exists: v1.0.0 (409)")
    reg = HuggingFaceRegistry(api=api, username="myuser")

    with pytest.raises(TagFailedException) as ei:
        reg.set_version_tag(bundle)
    assert ei.value.tag == "v1.0.0"
    assert ei.value.repo_id == "myuser/detect-ai-spark"


@pytest.mark.integration
def test_hf_from_token_factory() -> None:
    reg = HuggingFaceRegistry.from_token(token="hf_dummy12345", username="alice")
    assert reg._username == "alice"
    assert reg._get_repo_id("detect-ai-spark") == "alice/detect-ai-spark"
