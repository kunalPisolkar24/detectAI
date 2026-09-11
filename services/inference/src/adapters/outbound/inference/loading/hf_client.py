import os
import time

import structlog
from huggingface_hub import hf_hub_download, snapshot_download
from huggingface_hub.utils import HfHubHTTPError, LocalEntryNotFoundError

logger = structlog.get_logger()


def _is_transient_error(exc: Exception) -> bool:
    if isinstance(exc, (ConnectionError, TimeoutError, OSError)):
        return True
    msg = str(exc).lower()
    if any(k in msg for k in ("timeout", "connection", "network", "temporarily", "503", "429")):
        return True
    if isinstance(exc, HfHubHTTPError):
        status = getattr(exc, "response", None)
        code = getattr(status, "status_code", None) if status else None
        if code in (401, 403, 404):
            return False
        return True
    if "hfhubhttperror" in type(exc).__name__.lower():
        return True
    return False


def get_file(cache_dir: str, repo_id: str, filename: str, revision: str, local_only: bool) -> str:
    if local_only:
        try:
            return hf_hub_download(
                repo_id=repo_id,
                filename=filename,
                revision=revision,
                local_dir=cache_dir,
                local_files_only=True,
            )
        except (LocalEntryNotFoundError, FileNotFoundError) as e:
            raise FileNotFoundError(f"Local file {filename} not found in {cache_dir}: {e}") from e

    for attempt in range(3):
        try:
            return hf_hub_download(
                repo_id=repo_id, filename=filename, local_dir=cache_dir, revision=revision
            )
        except Exception as e:
            if not _is_transient_error(e) or attempt == 2:
                raise
            backoff = attempt + 1
            logger.warning(
                "model_download_retry",
                repo_id=repo_id,
                filename=filename,
                attempt=attempt + 1,
                backoff=backoff,
                error=str(e),
            )
            time.sleep(backoff)


def get_directory(cache_dir: str, repo_id: str, revision: str, local_only: bool) -> str:
    expected_dir = os.path.join(cache_dir, repo_id.split("/")[-1])
    if local_only:
        try:
            return snapshot_download(
                repo_id=repo_id, revision=revision, local_dir=expected_dir, local_files_only=True
            )
        except (LocalEntryNotFoundError, FileNotFoundError) as e:
            raise FileNotFoundError(f"Local directory {expected_dir} not found: {e}") from e

    for attempt in range(3):
        try:
            return snapshot_download(repo_id=repo_id, local_dir=expected_dir, revision=revision)
        except Exception as e:
            if not _is_transient_error(e) or attempt == 2:
                raise
            backoff = attempt + 1
            logger.warning(
                "model_download_retry", repo_id=repo_id, attempt=attempt + 1, backoff=backoff, error=str(e)
            )
            time.sleep(backoff)
