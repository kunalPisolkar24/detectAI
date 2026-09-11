import io
import os
import time

import onnxruntime as ort
import structlog
from transformers import BertTokenizerFast
from huggingface_hub import hf_hub_download, snapshot_download
from huggingface_hub.utils import LocalEntryNotFoundError

from src.adapters.outbound.inference.loading.provider_verifier import verify_providers
from src.adapters.outbound.inference.loading.safe_unpickle import RestrictedUnpickler as _BaseUnpickler
from src.application.ports.outbound.model_loader import IModelLoader
from src.domain.exceptions import ModelLoadError
from src.infrastructure.config import parse_inference_providers

logger = structlog.get_logger()

_ALLOWED_UNPICKLE_MODULES = frozenset(
    {"sklearn", "scipy", "numpy", "builtins", "collections", "copyreg"}
)


class RestrictedUnpickler(_BaseUnpickler):
    pass


def _is_transient_error(exc: Exception) -> bool:
    from src.adapters.outbound.inference.loading.hf_client import _is_transient_error as _impl

    return _impl(exc)


class HuggingFaceLoader(IModelLoader):
    def __init__(
        self,
        cache_dir: str,
        providers: list[str] | None = None,
        spark_model_revision: str = "9a48004391c71272d6fb1d164ed7c56e1fbfe360",
        flare_model_revision: str = "e1911c0be59f4e10f0d120f639d1358e46bc2086",
        telemetry=None,
    ) -> None:
        self.cache_dir = cache_dir
        os.makedirs(self.cache_dir, exist_ok=True)
        self.spark_model_revision = spark_model_revision
        self.flare_model_revision = flare_model_revision
        self.telemetry = telemetry
        if providers is None:
            providers = parse_inference_providers(
                os.getenv("INFERENCE_PROVIDERS", "CUDAExecutionProvider,CPUExecutionProvider")
            )
        elif isinstance(providers, str):
            providers = parse_inference_providers(providers)
        elif isinstance(providers, list):
            self.providers = providers
            return
        self.providers = providers

    def load(self, model_key: str):
        if model_key not in ("spark", "flare"):
            raise ValueError(f"Unknown model key: {model_key}")
        try:
            if model_key == "spark":
                return self._load_spark()
            return self._load_flare()
        except Exception as e:
            logger.error("model_load_failed_attempting_offline_fallback", model=model_key, error=str(e))
            try:
                result = self._load_spark(local_only=True) if model_key == "spark" else self._load_flare(local_only=True)
                try:
                    if self.telemetry is not None:
                        self.telemetry.record_provider_fallback(model_key, ",".join(self.providers), "offline-cache", "offline")
                    else:
                        from src.infrastructure.metrics import record_provider_fallback

                        record_provider_fallback(model_key, ",".join(self.providers), "offline-cache", "offline")
                except Exception:
                    pass
                return result
            except Exception as fallback:
                raise ModelLoadError(f"Failed to load {model_key}: {e} (Offline fallback also failed: {fallback})") from fallback

    def _load_spark(self, local_only: bool = False):
        repo_id = "kpisolkar24/detect-ai-spark"
        self._log_model_source("spark", repo_id, self.spark_model_revision)
        onnx_path = self._get_file(repo_id, "detect-ai-spark.onnx", self.spark_model_revision, local_only)
        tok_path = self._get_file(repo_id, "detect-ai-spark-tokenizer.pkl", self.spark_model_revision, local_only)
        session = ort.InferenceSession(onnx_path, providers=self.providers)
        verify_providers(session, "spark", repo_id, self.spark_model_revision, self.providers, self.telemetry)
        with open(tok_path, "rb") as f:
            data = f.read()
            tokenizer = RestrictedUnpickler(io.BytesIO(data)).load()
        return session, tokenizer

    def _load_flare(self, local_only: bool = False):
        repo_id = "kpisolkar24/detect-ai-flare"
        self._log_model_source("flare", repo_id, self.flare_model_revision)
        model_path = self._get_directory(repo_id, self.flare_model_revision, local_only)
        tokenizer = BertTokenizerFast.from_pretrained(model_path)
        session = ort.InferenceSession(os.path.join(model_path, "model.onnx"), providers=self.providers)
        verify_providers(session, "flare", repo_id, self.flare_model_revision, self.providers, self.telemetry)
        return session, tokenizer

    def _get_file(self, repo_id: str, filename: str, revision: str, local_only: bool) -> str:
        if local_only:
            try:
                return hf_hub_download(
                    repo_id=repo_id,
                    filename=filename,
                    revision=revision,
                    local_dir=self.cache_dir,
                    local_files_only=True,
                )
            except (LocalEntryNotFoundError, FileNotFoundError) as e:
                raise FileNotFoundError(f"Local file {filename} not found in {self.cache_dir}: {e}") from e
        for attempt in range(3):
            try:
                return hf_hub_download(repo_id=repo_id, filename=filename, local_dir=self.cache_dir, revision=revision)
            except Exception as e:
                if not _is_transient_error(e) or attempt == 2:
                    raise
                backoff = attempt + 1
                logger.warning("model_download_retry", repo_id=repo_id, filename=filename, attempt=attempt + 1, backoff=backoff, error=str(e))
                time.sleep(backoff)
        raise RuntimeError("unreachable")

    def _get_directory(self, repo_id: str, revision: str, local_only: bool) -> str:
        expected_dir = os.path.join(self.cache_dir, repo_id.split("/")[-1])
        if local_only:
            try:
                return snapshot_download(repo_id=repo_id, revision=revision, local_dir=expected_dir, local_files_only=True)
            except (LocalEntryNotFoundError, FileNotFoundError) as e:
                raise FileNotFoundError(f"Local directory {expected_dir} not found: {e}") from e
        for attempt in range(3):
            try:
                return snapshot_download(repo_id=repo_id, local_dir=expected_dir, revision=revision)
            except Exception as e:
                if not _is_transient_error(e) or attempt == 2:
                    raise
                backoff = attempt + 1
                logger.warning("model_download_retry", repo_id=repo_id, attempt=attempt + 1, backoff=backoff, error=str(e))
                time.sleep(backoff)
        raise RuntimeError("unreachable")

    def _log_model_source(self, model_key: str, repo_id: str, revision: str) -> None:
        logger.info("model_download_started", model=model_key, repo_id=repo_id, revision=revision, requested_providers=self.providers)
