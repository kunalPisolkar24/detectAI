"""The hub adapter: transient pulls retry with backoff, permanent ones die at once, the probe stays offline."""

import errno
from collections.abc import Sequence
from pathlib import Path

import httpx2
import pytest
from huggingface_hub.errors import EntryNotFoundError, HfHubHTTPError
from huggingface_hub.file_download import write_download_metadata

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


def test_an_unwritable_path_dies_without_a_retry(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    hub = _hub(monkeypatch, [PermissionError(errno.EACCES, "Permission denied")])
    sleeps = _sleeps(monkeypatch)
    store = _store(tmp_path)

    with pytest.raises(ArtifactPullError):
        store.pull(_spec())

    assert len(hub.calls) == 1
    assert sleeps == []


def test_the_root_is_resolved_to_an_absolute_path(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.chdir(tmp_path)
    _hub(monkeypatch, ["x"])
    store = _store(Path("models"))

    artifact_dir = store.pull(_spec())

    assert artifact_dir.is_absolute()
    assert artifact_dir == (tmp_path / "models" / "spark" / "onnx" / "fp16").resolve()


def test_the_progress_bars_are_disabled_when_a_pull_starts(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _hub(monkeypatch, ["x"])
    disabled: list[bool] = []
    monkeypatch.setattr(hf, "disable_progress_bars", lambda: disabled.append(True))
    store = _store(tmp_path)

    assert disabled == []

    store.pull(_spec())

    assert disabled == [True]


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


def _cached(root: Path, key: str, filename: str, revision: str) -> Path:
    """A file the hub has cached, with the revision it came from recorded."""
    local_dir = root / key
    path = local_dir / filename
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"artifact")
    write_download_metadata(
        local_dir=local_dir, filename=filename, commit_hash=revision, etag="etag"
    )
    return path


def test_locate_resolves_offline_at_the_pinned_revision(tmp_path: Path) -> None:
    _cached(tmp_path, "spark", "onnx/fp16/model.onnx", _REVISION)
    store = _store(tmp_path)

    artifact_dir = store.locate(_spec())

    assert artifact_dir == tmp_path / "spark" / "onnx" / "fp16"


def test_locate_never_reaches_the_hub(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    hub = _hub(monkeypatch, ["x"])
    _cached(tmp_path, "spark", "onnx/fp16/model.onnx", _REVISION)
    store = _store(tmp_path)

    store.locate(_spec())

    assert hub.calls == []


def test_an_artifact_from_another_revision_is_a_miss(tmp_path: Path) -> None:
    # The volume outlived a revision bump: the cached file belongs to another
    # commit, so it is not the artifact this pin names.
    _cached(tmp_path, "spark", "onnx/fp16/model.onnx", "b" * 40)
    store = _store(tmp_path)

    with pytest.raises(MissingArtifact):
        store.locate(_spec())


def test_a_file_that_is_not_cached_is_a_miss(tmp_path: Path) -> None:
    store = _store(tmp_path)

    with pytest.raises(MissingArtifact):
        store.locate(_spec())


def test_pull_creates_a_missing_root_volume(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root = tmp_path / "volumes" / "models"
    _hub(monkeypatch, ["x"])
    store = _store(root)

    store.pull(_spec())

    assert root.is_dir()
