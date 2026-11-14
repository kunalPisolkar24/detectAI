"""The orchestrator: probe-first, parallel pulls for the misses, fail-fast on the first failure."""

import threading
import time
from pathlib import Path

import pytest

from app.models import (
    ArtifactError,
    ArtifactPullError,
    MissingArtifact,
    ModelArtifactManager,
    ModelSpec,
)


def _spec(key: str) -> ModelSpec:
    return ModelSpec(
        key=key,
        repo="o/r",
        revision="a" * 40,
        artifact_dir="onnx/fp32",
        files=("onnx/fp32/model.onnx",),
    )


class StubStore:
    """locate answers from a hit set; pull answers with a path or raises."""

    def __init__(self, hits: frozenset[str] = frozenset(), fail_on: str | None = None) -> None:
        self._hits = hits
        self._fail_on = fail_on
        self.located: list[str] = []
        self.pulled: list[str] = []

    def locate(self, spec: ModelSpec) -> Path:
        self.located.append(spec.key)
        if spec.key in self._hits:
            return Path(f"/models/{spec.key}")
        raise MissingArtifact(f"{spec.key} missing")

    def pull(self, spec: ModelSpec) -> Path:
        self.pulled.append(spec.key)
        if spec.key == self._fail_on:
            raise ArtifactPullError(f"{spec.key} failed")
        return Path(f"/models/{spec.key}")


def test_a_cache_hit_never_pulls() -> None:
    store = StubStore(hits=frozenset({"flare", "spark"}))
    manager = ModelArtifactManager([_spec("flare"), _spec("spark")], store)

    artifacts = manager.ensure_all()

    assert artifacts == {"flare": Path("/models/flare"), "spark": Path("/models/spark")}
    assert store.located == ["flare", "spark"]
    assert store.pulled == []


def test_a_miss_pulls_and_returns_its_local_path() -> None:
    store = StubStore(hits=frozenset({"flare"}))
    manager = ModelArtifactManager([_spec("flare"), _spec("spark")], store)

    artifacts = manager.ensure_all()

    assert artifacts == {"flare": Path("/models/flare"), "spark": Path("/models/spark")}
    assert store.pulled == ["spark"]


def test_the_first_failure_aborts_the_ensure() -> None:
    store = StubStore(hits=frozenset({"flare"}), fail_on="spark")
    manager = ModelArtifactManager([_spec("flare"), _spec("spark")], store)

    with pytest.raises(ArtifactError):
        manager.ensure_all()


def test_a_failure_aborts_without_waiting_out_the_sibling() -> None:
    # The sibling is a multi-gigabyte download in the real world: the boot
    # must die on the failure, not after the sibling finishes.
    started = threading.Event()

    class SlowStore:
        def locate(self, spec: ModelSpec) -> Path:
            raise MissingArtifact(f"{spec.key} missing")

        def pull(self, spec: ModelSpec) -> Path:
            if spec.key == "bad":
                assert started.wait(timeout=5)
                raise ArtifactPullError("bad failed")
            started.set()
            time.sleep(3)
            return Path(f"/models/{spec.key}")

    manager = ModelArtifactManager([_spec("bad"), _spec("slow")], SlowStore())

    began = time.perf_counter()
    with pytest.raises(ArtifactError):
        manager.ensure_all()

    assert time.perf_counter() - began < 2.0


def test_every_miss_pulls_and_returns_its_local_path() -> None:
    store = StubStore()
    manager = ModelArtifactManager([_spec("flare"), _spec("spark")], store)

    artifacts = manager.ensure_all()

    assert artifacts == {"flare": Path("/models/flare"), "spark": Path("/models/spark")}
    assert sorted(store.pulled) == ["flare", "spark"]
