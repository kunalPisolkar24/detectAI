"""HuggingFace registry adapter — injected HfApi, redacted errors."""

from __future__ import annotations

import logging
from typing import Any

from huggingface_hub import HfApi

from src.core.exceptions import TagFailedException, UploadFailedException
from src.domain.schemas import ArtifactBundle
from src.interfaces.registry import IModelRegistry

logger = logging.getLogger(__name__)


def _redact_error_message(msg: str) -> str:
    # best-effort: don't leak token if HF echoes it back
    lower = msg.lower()
    if "token" in lower or "bearer" in lower or "hf_" in lower:
        return "HuggingFace error (redacted — contains auth material)"
    return msg


class HuggingFaceRegistry(IModelRegistry):
    def __init__(self, api: HfApi, username: str) -> None:
        self._api = api
        self._username = username

    @classmethod
    def from_token(cls, token: str, username: str) -> "HuggingFaceRegistry":
        return cls(api=HfApi(token=token), username=username)

    def _get_repo_id(self, model_key: str) -> str:
        return f"{self._username}/{model_key}"

    def upload_artifacts(self, bundle: ArtifactBundle) -> str:
        repo_id = self._get_repo_id(bundle.metadata.model_key)
        try:
            url: Any = self._api.upload_folder(
                folder_path=str(bundle.local_path),
                repo_id=repo_id,
                repo_type="model",
                commit_message=f"Upload artifacts for version {bundle.metadata.version}",
            )
            logger.info("hf_upload_ok", extra={"repo_id": repo_id, "version": bundle.metadata.version})
            return str(url)
        except Exception as e:
            msg = _redact_error_message(str(e))
            logger.error("hf_upload_failed", extra={"repo_id": repo_id})
            raise UploadFailedException(f"Failed to upload to HF repo {repo_id}: {msg}", repo_id=repo_id) from e

    def set_version_tag(self, bundle: ArtifactBundle) -> None:
        repo_id = self._get_repo_id(bundle.metadata.model_key)
        try:
            self._api.create_tag(
                repo_id=repo_id,
                tag=bundle.metadata.version,
                tag_message=bundle.metadata.description,
            )
            logger.info("hf_tag_ok", extra={"repo_id": repo_id, "tag": bundle.metadata.version})
        except Exception as e:
            msg = _redact_error_message(str(e))
            # huggingface_hub often raises HfHubHTTPError with 409 if tag exists
            low = str(e).lower()
            if "already exists" in low or "409" in low or "conflict" in low:
                logger.warning("hf_tag_exists", extra={"repo_id": repo_id, "tag": bundle.metadata.version})
                raise TagFailedException(
                    f"Tag {bundle.metadata.version!r} already exists on {repo_id}: {msg}",
                    repo_id=repo_id,
                    tag=bundle.metadata.version,
                ) from e
            logger.error("hf_tag_failed", extra={"repo_id": repo_id, "tag": bundle.metadata.version})
            raise TagFailedException(
                f"Failed to tag version on HF repo {repo_id}: {msg}",
                repo_id=repo_id,
                tag=bundle.metadata.version,
            ) from e
