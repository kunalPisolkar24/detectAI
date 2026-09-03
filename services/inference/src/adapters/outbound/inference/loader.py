import io
import os
import pickle
import time
import onnxruntime as ort
import structlog
from transformers import BertTokenizerFast
from huggingface_hub import hf_hub_download, snapshot_download
from huggingface_hub.utils import HfHubHTTPError, LocalEntryNotFoundError

from src.application.ports.outbound.inference import IModelLoader
from src.domain.exceptions import ModelLoadError
from src.infrastructure.config import parse_inference_providers

logger = structlog.get_logger()

_GPU_PROVIDERS = frozenset({"CUDAExecutionProvider", "TensorrtExecutionProvider", "ROCMExecutionProvider"})
_ALLOWED_UNPICKLE_MODULES = frozenset(
    {
        "sklearn",
        "scipy",
        "numpy",
        "builtins",
        "collections",
        "copyreg",
    }
)


class RestrictedUnpickler(pickle.Unpickler):
    def find_class(self, module: str, name: str):  # type: ignore[override]
        root = module.split(".")[0]
        if root not in _ALLOWED_UNPICKLE_MODULES:
            raise pickle.UnpicklingError(f"Blocked unpickle of {module}.{name}")
        return super().find_class(module, name)


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
    # Fallback: treat unknown Hf errors as transient
    if "hfhubhttperror" in type(exc).__name__.lower():
        return True
    return False

class HuggingFaceLoader(IModelLoader):
    def __init__(
        self,
        cache_dir: str,
        providers: list[str] | None = None,
        spark_model_revision: str = "9a48004391c71272d6fb1d164ed7c56e1fbfe360",
        flare_model_revision: str = "e1911c0be59f4e10f0d120f639d1358e46bc2086",
    ):
        self.cache_dir = cache_dir
        os.makedirs(self.cache_dir, exist_ok=True)
        self.spark_model_revision = spark_model_revision
        self.flare_model_revision = flare_model_revision
        provider_source = providers
        if provider_source is None:
            provider_source = os.getenv(
                "INFERENCE_PROVIDERS",
                "CUDAExecutionProvider,CPUExecutionProvider",
            )
        if isinstance(provider_source, list):
            self.providers = provider_source
        else:
            self.providers = parse_inference_providers(provider_source)

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
                if model_key == "spark":
                    return self._load_spark(local_only=True)
                return self._load_flare(local_only=True)
            except Exception as fallback_error:
                raise ModelLoadError(
                    f"Failed to load {model_key}: {str(e)} (Offline fallback also failed: {str(fallback_error)})"
                ) from fallback_error
            raise ModelLoadError(f"Failed to load {model_key}: {str(e)}") from e

    def _load_spark(self, local_only: bool = False):
        repo_id = "kpisolkar24/detect-ai-spark"
        self._log_model_source("spark", repo_id, self.spark_model_revision)
        
        onnx_path = self._get_file(
            repo_id=repo_id,
            filename="detect-ai-spark.onnx",
            revision=self.spark_model_revision,
            local_only=local_only
        )
        tok_path = self._get_file(
            repo_id=repo_id,
            filename="detect-ai-spark-tokenizer.pkl",
            revision=self.spark_model_revision,
            local_only=local_only
        )
        
        session = ort.InferenceSession(onnx_path, providers=self.providers)
        self._verify_providers(session, "spark", repo_id, self.spark_model_revision)
        with open(tok_path, "rb") as f:
            data = f.read()
            tokenizer = RestrictedUnpickler(io.BytesIO(data)).load()

        return session, tokenizer

    def _load_flare(self, local_only: bool = False):
        repo_id = "kpisolkar24/detect-ai-flare"
        self._log_model_source("flare", repo_id, self.flare_model_revision)
        
        model_path = self._get_directory(
            repo_id=repo_id,
            revision=self.flare_model_revision,
            local_only=local_only
        )
        
        tokenizer = BertTokenizerFast.from_pretrained(model_path)
        session = ort.InferenceSession(os.path.join(model_path, "model.onnx"), providers=self.providers)
        self._verify_providers(session, "flare", repo_id, self.flare_model_revision)
        
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
                return hf_hub_download(
                    repo_id=repo_id,
                    filename=filename,
                    local_dir=self.cache_dir,
                    revision=revision,
                )
            except Exception as e:
                is_last = attempt == 2
                if not _is_transient_error(e) or is_last:
                    raise e
                backoff = 1 * (attempt + 1)
                logger.warning("model_download_retry", repo_id=repo_id, filename=filename, attempt=attempt + 1, backoff=backoff, error=str(e))
                time.sleep(backoff)

    def _get_directory(self, repo_id: str, revision: str, local_only: bool) -> str:
        expected_dir = os.path.join(self.cache_dir, repo_id.split("/")[-1])
        if local_only:
            try:
                return snapshot_download(
                    repo_id=repo_id,
                    revision=revision,
                    local_dir=expected_dir,
                    local_files_only=True,
                )
            except (LocalEntryNotFoundError, FileNotFoundError) as e:
                raise FileNotFoundError(f"Local directory {expected_dir} not found: {e}") from e

        for attempt in range(3):
            try:
                return snapshot_download(
                    repo_id=repo_id,
                    local_dir=expected_dir,
                    revision=revision,
                )
            except Exception as e:
                is_last = attempt == 2
                if not _is_transient_error(e) or is_last:
                    raise e
                backoff = 1 * (attempt + 1)
                logger.warning("model_download_retry", repo_id=repo_id, attempt=attempt + 1, backoff=backoff, error=str(e))
                time.sleep(backoff)

    def _log_model_source(self, model_key: str, repo_id: str, revision: str) -> None:
        logger.info(
            "model_download_started",
            model=model_key,
            repo_id=repo_id,
            revision=revision,
            requested_providers=self.providers,
        )

    def _verify_providers(
        self,
        session: ort.InferenceSession,
        model_key: str,
        repo_id: str,
        revision: str,
    ) -> None:
        requested_gpu = any(p in _GPU_PROVIDERS for p in self.providers)
        active_providers = session.get_providers()
        active_gpu = any(p in _GPU_PROVIDERS for p in active_providers)

        if requested_gpu and not active_gpu:
            logger.warning(
                "gpu_provider_unavailable_falling_back_to_cpu",
                model=model_key,
                repo_id=repo_id,
                revision=revision,
                requested=self.providers,
                active=active_providers,
            )
        else:
            logger.info(
                "model_loaded",
                model=model_key,
                repo_id=repo_id,
                revision=revision,
                requested_providers=self.providers,
                active_providers=active_providers,
            )
