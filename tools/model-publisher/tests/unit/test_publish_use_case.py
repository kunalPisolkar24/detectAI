from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from src.application.dto import PublishCommand
from src.application.use_cases import PublishModelUseCase
from src.core.exceptions import ArtifactNotFoundException, UploadFailedException
from src.domain.schemas import ArtifactBundle, ModelMetadata
from src.interfaces.artifact_store import IArtifactStore
from src.interfaces.registry import IModelRegistry


class FakeRegistry(IModelRegistry):
    def __init__(self, *, fail_upload: bool = False, fail_tag_exists: bool = False) -> None:
        self.calls: list[str] = []
        self.fail_upload = fail_upload
        self.fail_tag_exists = fail_tag_exists
        self._username = "test-user"

    def _get_repo_id(self, model_key: str) -> str:  # type: ignore[no-untyped-def]
        return f"{self._username}/{model_key}"

    def upload_artifacts(self, bundle: ArtifactBundle) -> str:
        self.calls.append("upload")
        if self.fail_upload:
            raise UploadFailedException("boom", repo_id="x")
        return f"https://huggingface.co/{self._get_repo_id(bundle.metadata.model_key)}/tree/{bundle.metadata.version}"

    def set_version_tag(self, bundle: ArtifactBundle) -> None:
        self.calls.append("tag")
        if self.fail_tag_exists:
            from src.core.exceptions import TagFailedException

            raise TagFailedException("already exists", repo_id="x", tag=bundle.metadata.version)


class FakeStore(IArtifactStore):
    def __init__(self, base: Path, *, missing: bool = False) -> None:
        self.base = base
        self.missing = missing
        self.resolve_calls: list[tuple[str, str]] = []

    def assets_path_for(self, model_key: str) -> Path:
        return self.base / "assets" / model_key

    def resolve(self, model_key: str, version: str, description: str | None = None) -> ArtifactBundle:
        self.resolve_calls.append((model_key, version))
        if self.missing:
            raise ArtifactNotFoundException("not found", path=str(self.assets_path_for(model_key)))
        desc = description or f"Production release {version}"
        return ArtifactBundle(
            metadata=ModelMetadata(model_key=model_key, version=version, description=desc),
            local_path=self.assets_path_for(model_key),
        )


def test_use_case_happy_path(tmp_path: Path) -> None:
    (tmp_path / "assets" / "detect-ai-spark").mkdir(parents=True)
    registry = FakeRegistry()
    store = FakeStore(tmp_path)
    uc = PublishModelUseCase(registry, store)

    result = uc.execute(PublishCommand(model="detect-ai-spark", version="v1.0.0"))

    assert result.model == "detect-ai-spark"
    assert result.version == "v1.0.0"
    assert result.repo_id == "test-user/detect-ai-spark"
    assert result.url is not None and "huggingface.co" in result.url
    assert registry.calls == ["upload", "tag"]
    assert store.resolve_calls == [("detect-ai-spark", "v1.0.0")]


def test_use_case_dry_run_no_network_calls(tmp_path: Path) -> None:
    (tmp_path / "assets" / "detect-ai-spark").mkdir(parents=True)
    registry = FakeRegistry()
    store = FakeStore(tmp_path)
    uc = PublishModelUseCase(registry, store)

    result = uc.execute(PublishCommand(model="detect-ai-spark", version="v1.0.0", dry_run=True))

    assert result.dry_run is True
    assert result.url is None
    assert registry.calls == []  # no upload/tag on dry-run
    assert store.resolve_calls == [("detect-ai-spark", "v1.0.0")]


def test_use_case_propagates_artifact_not_found(tmp_path: Path) -> None:
    registry = FakeRegistry()
    store = FakeStore(tmp_path, missing=True)
    uc = PublishModelUseCase(registry, store)

    with pytest.raises(ArtifactNotFoundException):
        uc.execute(PublishCommand(model="detect-ai-spark", version="v1.0.0"))
    assert registry.calls == []


def test_use_case_upload_failure_does_not_tag(tmp_path: Path) -> None:
    (tmp_path / "assets" / "detect-ai-spark").mkdir(parents=True)
    registry = FakeRegistry(fail_upload=True)
    store = FakeStore(tmp_path)
    uc = PublishModelUseCase(registry, store)

    with pytest.raises(UploadFailedException):
        uc.execute(PublishCommand(model="detect-ai-spark", version="v1.0.0"))

    assert registry.calls == ["upload"]
    assert "tag" not in registry.calls


def test_use_case_custom_description(tmp_path: Path) -> None:
    (tmp_path / "assets" / "detect-ai-spark").mkdir(parents=True)

    captured: dict[str, Any] = {}

    class CapturingStore(FakeStore):
        def resolve(self, model_key: str, version: str, description: str | None = None) -> ArtifactBundle:
            captured["description"] = description
            return super().resolve(model_key, version, description)

    registry = FakeRegistry()
    store = CapturingStore(tmp_path)
    uc = PublishModelUseCase(registry, store)

    uc.execute(PublishCommand(model="detect-ai-spark", version="v1.0.0", description="hotfix"))
    assert captured["description"] == "hotfix"

    uc.execute(PublishCommand(model="detect-ai-spark", version="v1.0.1"))
    # default template
    assert captured["description"] == "Production release v1.0.1"
