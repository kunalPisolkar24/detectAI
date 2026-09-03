import numpy as np
from src.application.ports.outbound.inference import ISyncBatchInferenceEngine
from src.adapters.outbound.inference.engines.base import BaseEngine
from src.domain.exceptions import InferenceError


class FlareEngine(ISyncBatchInferenceEngine, BaseEngine):
    def __init__(self, resources, max_length: int = 256):
        self.session, self.tokenizer = resources
        self.max_length = max_length
        # Hoist input names once
        try:
            self.input_names = [inp.name for inp in self.session.get_inputs()]
        except Exception as e:
            raise InferenceError(f"Flare session has no inputs: {e}") from e
        if not self.input_names:
            raise InferenceError("Flare session has no inputs")

    def predict_batch(self, texts: list[str]) -> list[float]:
        if not texts:
            return []
        try:
            inputs = self.tokenizer(
                texts, return_tensors="np", padding=True, truncation=True, max_length=self.max_length
            )

            ort_inputs = {k: v.astype(np.int64) for k, v in inputs.items() if k in self.input_names}

            raw = self.session.run(None, ort_inputs)[0]
            raw = np.asarray(raw)

            # Handle various output shapes consistently with Spark
            if raw.ndim == 1:
                # Single logit per sample -> sigmoid
                probs = self.sigmoid(raw)
                return np.clip(probs, 0.0, 1.0).astype(float).tolist()
            if raw.ndim == 2 and raw.shape[1] == 1:
                probs = self.sigmoid(raw.flatten())
                return np.clip(probs, 0.0, 1.0).astype(float).tolist()
            if raw.ndim == 2 and raw.shape[1] == 2:
                probs = self.softmax(raw)
                return probs[:, 1].astype(float).tolist()
            raise InferenceError(f"Unexpected Flare output shape {raw.shape}, expected (N,1) or (N,2)")
        except InferenceError:
            raise
        except Exception as e:
            raise InferenceError(f"Flare batch inference failed: {e}") from e
