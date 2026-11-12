"""The hub adapter: transient pulls retry with backoff, permanent ones die at once, the probe stays offline."""

import errno
from collections.abc import Sequence
from pathlib import Path

import httpx2
import pytest
from huggingface_hub.errors import EntryNotFoundError, HfHubHTTPError

import app.models.pulling.huggingface as hf
from app.models import ArtifactPullError, MissingArtifact
from app.models.pulling.huggingface import HuggingFaceStore
from app.models.pulling.spec import ModelSpec

_REVISION = "a" * 40


class HubStub:
    """Scripted hf_hub_download: every call consumes the next outcome and is recorded."""

    def __init__(self, outcomes: Sequence[Exception | str]) -> None:
        self._outcomes = list(outcomes)
        self.calls: list[dict[str, object]] = []

    def __call__(self, **kwargs: object) -> str:
        self.calls.append(kwargs)
        outcome = self._outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return str(outcome)


def _spec() -> ModelSpec:
    return ModelSpec(
        key="spark",
        repo="org/spark",
        revision=_REVISION,
        artifact_dir="onnx/fp16",
        files=("onnx/fp16/model.onnx",),
    )


def _store(root: Path, token: str | None = None) -> HuggingFaceStore:
    return HuggingFaceStore(root=root, token=token)


def _hub(monkeypatch: pytest.MonkeyPatch, outcomes: Sequence[Exception | str]) -> HubStub:
    stub = HubStub(outcomes)
    monkeypatch.setattr(hf, "hf_hub_download", stub)
    return stub


def _sleeps(monkeypatch: pytest.MonkeyPatch) -> list[int]:
    sleeps: list[int] = []
    monkeypatch.setattr(hf.time, "sleep", sleeps.append)
    return sleeps


def _http_error(status: int) -> HfHubHTTPError:
    request = httpx2.Request("GET", f"https://hub.test/org/spark/resolve/{_REVISION}")
    response = httpx2.Response(status_code=status, request=request)
    return HfHubHTTPError(f"HTTP {status}", response=response)


def test_a_transient_timeout_retries_then_succeeds(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    hub = _hub(monkeypatch, [TimeoutError("read timed out"), TimeoutError("read timed out"), "x"])
    sleeps = _sleeps(monkeypatch)
    store = _store(tmp_path)

    artifact_dir = store.pull(_spec())

    assert artifact_dir == tmp_path / "spark" / "onnx" / "fp16"
    assert len(hub.calls) == 3
    assert sleeps == [1, 2]


@pytest.mark.parametrize("status", [429, 503])
def test_a_transient_http_status_retries_then_succeeds(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, status: int
) -> None:
    hub = _hub(monkeypatch, [_http_error(status), "x"])
    sleeps = _sleeps(monkeypatch)
    store = _store(tmp_path)

    store.pull(_spec())

    assert len(hub.calls) == 2
    assert sleeps == [1]


def test_a_hub_entry_miss_dies_on_the_first_attempt(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    hub = _hub(monkeypatch, [EntryNotFoundError("onnx/fp16/model.onnx is missing")])
    sleeps = _sleeps(monkeypatch)
    store = _store(tmp_path)

    with pytest.raises(ArtifactPullError):
        store.pull(_spec())

    assert len(hub.calls) == 1
    assert sleeps == []


@pytest.mark.parametrize("status", [401, 403, 404])
def test_a_permanent_http_status_never_retries(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, status: int
) -> None:
    hub = _hub(monkeypatch, [_http_error(status)])
    sleeps = _sleeps(monkeypatch)
    store = _store(tmp_path)

    with pytest.raises(ArtifactPullError):
        store.pull(_spec())

    assert len(hub.calls) == 1
    assert sleeps == []


def test_disk_full_dies_without_a_retry(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    hub = _hub(monkeypatch, [OSError(errno.ENOSPC, "No space left on device")])
    sleeps = _sleeps(monkeypatch)
    store = _store(tmp_path)

    with pytest.raises(ArtifactPullError):
        store.pull(_spec())

    assert len(hub.calls) == 1
    assert sleeps == []


def test_the_token_reaches_the_hub_when_set(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    hub = _hub(monkeypatch, ["x"])
    store = _store(tmp_path, token="seeded-secret")

    store.pull(_spec())

    assert hub.calls == [
        {
            "repo_id": "org/spark",
            "filename": "onnx/fp16/model.onnx",
            "revision": _REVISION,
            "local_dir": tmp_path / "spark",
            "local_files_only": False,
            "token": "seeded-secret",
        }
    ]


def test_an_unset_token_never_reaches_the_hub(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    hub = _hub(monkeypatch, ["x"])
    store = _store(tmp_path)

    store.pull(_spec())

    assert "token" not in hub.calls[0]


def test_locate_resolves_offline_at_the_pinned_revision(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    hub = _hub(monkeypatch, ["x"])
    store = _store(tmp_path)

    artifact_dir = store.locate(_spec())

    assert artifact_dir == tmp_path / "spark" / "onnx" / "fp16"
    assert hub.calls[0]["local_files_only"] is True
    assert "token" not in hub.calls[0]


def test_a_locate_miss_raises_missing_artifact_without_a_retry(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    hub = _hub(monkeypatch, [EntryNotFoundError("nothing cached")])
    sleeps = _sleeps(monkeypatch)
    store = _store(tmp_path)

    with pytest.raises(MissingArtifact):
        store.locate(_spec())

    assert len(hub.calls) == 1
    assert sleeps == []


def test_pull_creates_a_missing_root_volume(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root = tmp_path / "volumes" / "models"
    _hub(monkeypatch, ["x"])
    store = _store(root)

    store.pull(_spec())

    assert root.is_dir()
