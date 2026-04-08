import os
import pickle
import onnxruntime as ort
import structlog
from transformers import BertTokenizerFast
from huggingface_hub import snapshot_download, hf_hub_download
from src.core.interfaces import IModelLoader
from src.core.exceptions import ModelLoadError
from src.core.inference_providers import parse_inference_providers

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
            raise ModelLoadError(f"Failed to load {model_key}: {str(e)}")

    def _load_spark(self):
        repo_id = "kpisolkar24/detect-ai-spark"
        onnx_path = hf_hub_download(
            repo_id=repo_id,
            filename="detect-ai-spark.onnx",
            local_dir=self.cache_dir,
            revision=self.spark_model_revision,
        )
        tok_path = hf_hub_download(
            repo_id=repo_id,
            filename="detect-ai-spark-tokenizer.pkl",
            local_dir=self.cache_dir,
            revision=self.spark_model_revision,
        )
        
        session = ort.InferenceSession(onnx_path, providers=self.providers)
        self._verify_providers(session, "spark")
        with open(tok_path, 'rb') as f:
            tokenizer = pickle.load(f)
            
        return session, tokenizer

    def _load_flare(self):
        repo_id = "kpisolkar24/detect-ai-flare"
        model_path = snapshot_download(
            repo_id=repo_id,
            local_dir=os.path.join(self.cache_dir, "flare"),
            revision=self.flare_model_revision,
        )
        
        tokenizer = BertTokenizerFast.from_pretrained(model_path)
        session = ort.InferenceSession(os.path.join(model_path, "model.onnx"), providers=self.providers)
        self._verify_providers(session, "flare")
        
        return session, tokenizer

    def _verify_providers(self, session: ort.InferenceSession, model_key: str) -> None:
        requested_gpu = any(p in _GPU_PROVIDERS for p in self.providers)
        active_providers = session.get_providers()
        active_gpu = any(p in _GPU_PROVIDERS for p in active_providers)

        if requested_gpu and not active_gpu:
            logger.warning(
                "gpu_provider_unavailable_falling_back_to_cpu",
                model=model_key,
                requested=self.providers,
                active=active_providers,
            )
        else:
            logger.info(
                "model_loaded",
                model=model_key,
                active_providers=active_providers,
            )
