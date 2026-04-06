import os
import pickle
import onnxruntime as ort
from transformers import BertTokenizer, BertTokenizerFast
from huggingface_hub import snapshot_download, hf_hub_download
from src.core.interfaces import IModelLoader
from src.core.exceptions import ModelLoadError
from src.core.inference_providers import parse_inference_providers

class HuggingFaceLoader(IModelLoader):
    def __init__(self, cache_dir: str, providers: list[str] | None = None):
        self.cache_dir = cache_dir
        os.makedirs(self.cache_dir, exist_ok=True)
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
        onnx_path = hf_hub_download(repo_id=repo_id, filename="detect-ai-spark.onnx", local_dir=self.cache_dir)
        tok_path = hf_hub_download(repo_id=repo_id, filename="detect-ai-spark-tokenizer.pkl", local_dir=self.cache_dir)
        
        session = ort.InferenceSession(onnx_path, providers=self.providers)
        with open(tok_path, 'rb') as f:
            tokenizer = pickle.load(f)
            
        return session, tokenizer

    def _load_flare(self):
        repo_id = "kpisolkar24/detect-ai-flare"
        model_path = snapshot_download(repo_id=repo_id, local_dir=os.path.join(self.cache_dir, "flare"))
        
        tokenizer = BertTokenizerFast.from_pretrained(model_path)
        session = ort.InferenceSession(os.path.join(model_path, "model.onnx"), providers=self.providers)
        
        return session, tokenizer
