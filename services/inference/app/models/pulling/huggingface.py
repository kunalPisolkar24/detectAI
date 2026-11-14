"""The hub-backed artifact store: per-file pulls with progress logs and typed failures."""

import errno
import logging
import time
from pathlib import Path

from huggingface_hub import hf_hub_download
from huggingface_hub.errors import (
    EntryNotFoundError,
    HfHubHTTPError,
    OfflineModeIsEnabled,
)
from huggingface_hub.file_download import read_download_metadata
from huggingface_hub.utils import disable_progress_bars

from ..errors import ArtifactPullError, MissingArtifact
from .spec import ModelSpec

logger = logging.getLogger(__name__)

_PULL_ATTEMPTS = 3

_TRANSIENT_WORDS = ("timeout", "connect", "network", "protocol", "temporarily", "429", "503")

# The filesystem faults a retry cannot fix: the disk is full, the path is not
# writable, the mount is read-only, the file is gone.
_PERMANENT_ERRNOS = frozenset({
    errno.ENOSPC,
    errno.EACCES,
    errno.EPERM,
    errno.EROFS,
    errno.ENOENT,
})


class HuggingFaceStore:
    """Satisfies ArtifactStore structurally; hub failures surface only as the typed vocabulary."""

    def __init__(self, root: Path, token: str | None) -> None:
        # Resolved once: every path the store hands out is absolute, so no
        # later working-directory change can move the artifacts under it.
        self._root = Path(root).expanduser().resolve()
        self._token = token

    def locate(self, spec: ModelSpec) -> Path:
        """Offline resolve at the pinned revision; raises MissingArtifact on a miss."""
        for filename in spec.files:
            self._verify_cached(spec, filename)
        return self._artifact_dir(spec)

    def _verify_cached(self, spec: ModelSpec, filename: str) -> None:
        """The file must be cached, and it must carry the pinned revision.

        The hub hands back a cached file even when it belongs to another
        commit, so a volume that outlived a revision bump would otherwise keep
        serving the old build under the new pin.
        """
        metadata = read_download_metadata(self._root / spec.key, filename)
        if metadata is None:
            raise MissingArtifact(
                f"{spec.key} is not present locally at {spec.revision}: "
                f"{filename} is not cached"
            )
        if metadata.commit_hash != spec.revision:
            raise MissingArtifact(
                f"{spec.key} is not present locally at {spec.revision}: "
                f"{filename} belongs to another revision"
            )

    def pull(self, spec: ModelSpec) -> Path:
        """Fetch the spec's files with retries and progress logs; returns the local artifact dir."""
        # The store logs its own progress; the hub's bars would only duplicate it.
        disable_progress_bars()
        started = time.perf_counter()
        logger.info(
            "%s: pulling %d files from %s@%s", spec.key, len(spec.files), spec.repo, spec.revision
        )
        self._root.mkdir(parents=True, exist_ok=True)
        for index, filename in enumerate(spec.files, start=1):
            self._pull_file(spec, filename, index)
        logger.info("%s: pull complete in %.1fs", spec.key, time.perf_counter() - started)
        return self._artifact_dir(spec)

    def _pull_file(self, spec: ModelSpec, filename: str, index: int) -> None:
        for attempt in range(1, _PULL_ATTEMPTS + 1):
            try:
                self._download(spec, filename, local_files_only=False)
            except Exception as error:
                if not self._is_transient(error) or attempt == _PULL_ATTEMPTS:
                    raise ArtifactPullError(
                        f"{spec.key}: {filename} failed after {attempt} attempt(s): {error}"
                    ) from error
                backoff = attempt
                logger.warning(
                    "%s: retry %s in %ds (attempt %d/%d): %s",
                    spec.key, filename, backoff, attempt, _PULL_ATTEMPTS, error,
                )
                time.sleep(backoff)
            else:
                logger.info("%s: file %d/%d done: %s", spec.key, index, len(spec.files), filename)
                return

    def _download(self, spec: ModelSpec, filename: str, local_files_only: bool) -> str:
        kwargs: dict[str, str] = {"token": self._token} if self._token else {}
        return hf_hub_download(
            repo_id=spec.repo,
            filename=filename,
            revision=spec.revision,
            local_dir=self._root / spec.key,
            local_files_only=local_files_only,
            **kwargs,
        )

    def _artifact_dir(self, spec: ModelSpec) -> Path:
        return self._root / spec.key / spec.artifact_dir

    def _is_transient(self, error: Exception) -> bool:
        """Auth, offline mode, and missing artifacts are permanent; disk-full dies loud; network retries."""
        if isinstance(error, (OfflineModeIsEnabled, EntryNotFoundError)):
            return False
        if isinstance(error, HfHubHTTPError):
            status = getattr(getattr(error, "response", None), "status_code", None)
            return status is not None and status not in (401, 403, 404)
        name = type(error).__name__.lower()
        if any(word in name for word in _TRANSIENT_WORDS):
            return True
        if isinstance(error, OSError):
            return error.errno not in _PERMANENT_ERRNOS
        return any(word in str(error).lower() for word in _TRANSIENT_WORDS)
