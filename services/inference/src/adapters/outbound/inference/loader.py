import os
import time
import pickle
import onnxruntime as ort
import structlog
from transformers import BertTokenizerFast
from huggingface_hub import snapshot_download, hf_hub_download
from src.application.ports.outbound.inference import IModelLoader
from src.domain.exceptions import ModelLoadError
from src.infrastructure.config import parse_inference_providers

logger = structlog.get_logger()

_GPU_PROVIDERS = frozenset({"CUDAExecutionProvider", "TensorrtExecutionProvider", "ROCMExecutionProvider"})

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
        self.providers = parse_inference_providers(provider_source)

    def load(self, model_key: str):
        try:
            if model_key == "spark":
                return self._load_spark()
            elif model_key == "flare":
                return self._load_flare()
            else:
                raise ValueError(f"Unknown model key: {model_key}")
        except Exception as e:
            logger.error("model_load_failed_attempting_offline_fallback", model=model_key, error=str(e))
            try:
                if model_key == "spark":
                    return self._load_spark(local_only=True)
                elif model_key == "flare":
                    return self._load_flare(local_only=True)
            except Exception as fallback_error:
                raise ModelLoadError(f"Failed to load {model_key} even with offline fallback: {str(fallback_error)}") from fallback_error
            raise ModelLoadError(f"Failed to load {model_key}: {str(e)}")

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
        with open(tok_path, 'rb') as f:
            tokenizer = pickle.load(f)
            
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
            expected_path = os.path.join(self.cache_dir, filename)
            if os.path.exists(expected_path):
                return expected_path
            raise FileNotFoundError(f"Local file {filename} not found in {self.cache_dir}")

        for attempt in range(3):
            try:
                return hf_hub_download(
                    repo_id=repo_id,
                    filename=filename,
                    local_dir=self.cache_dir,
                    revision=revision,
                )
            except Exception as e:
                if attempt == 2:
                    raise e
                time.sleep(1 * (attempt + 1))

    def _get_directory(self, repo_id: str, revision: str, local_only: bool) -> str:
        expected_dir = os.path.join(self.cache_dir, repo_id.split("/")[-1])
        if local_only:
            if os.path.exists(expected_dir):
                return expected_dir
            raise FileNotFoundError(f"Local directory {expected_dir} not found")

        for attempt in range(3):
            try:
                return snapshot_download(
                    repo_id=repo_id,
                    local_dir=expected_dir,
                    revision=revision,
                )
            except Exception as e:
                if attempt == 2:
                    raise e
                time.sleep(1 * (attempt + 1))

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
