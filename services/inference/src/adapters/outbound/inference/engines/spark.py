import numpy as np
from src.application.ports.outbound.inference import ISyncBatchInferenceEngine
from src.adapters.outbound.inference.engines.base import BaseEngine
from src.domain.exceptions import InferenceError


class SparkEngine(ISyncBatchInferenceEngine, BaseEngine):
    def __init__(self, resources):
        self.session, self.tokenizer = resources
        try:
            inputs = self.session.get_inputs()
            if not inputs:
                raise InferenceError("Spark session has no inputs")
            self.input_name = inputs[0].name
        except InferenceError:
            raise
        except Exception as e:
            raise InferenceError(f"Failed to read Spark session inputs: {e}") from e

    def predict_batch(self, texts: list[str]) -> list[float]:
        if not texts:
            return []
        outputs = None
        try:
            # Sparse matrix could be large; keep batch size bounded by caller (BATCH_SIZE)
            vectorized = self.tokenizer.transform(texts).toarray().astype(np.float32)

            outputs = self.session.run(None, {self.input_name: vectorized})
            raw = np.asarray(outputs[0])

            if raw.ndim == 1:
                # Single logit -> sigmoid and clip to [0,1]
                probs = self.sigmoid(raw)
                return np.clip(probs, 0.0, 1.0).astype(float).tolist()
            if raw.ndim == 2 and raw.shape[1] == 1:
                probs = self.sigmoid(raw.flatten())
                return np.clip(probs, 0.0, 1.0).astype(float).tolist()
            if raw.ndim == 2 and raw.shape[1] == 2:
                probs = self.softmax(raw)
                return np.clip(probs[:, 1], 0.0, 1.0).astype(float).tolist()
            raise InferenceError(f"Unexpected Spark output shape {raw.shape}, expected (N,), (N,1) or (N,2)")
        except InferenceError:
            raise
        except Exception as e:
            shape_info = "Unknown"
            if outputs is not None and isinstance(outputs, list) and len(outputs) > 0 and hasattr(outputs[0], "shape"):
                shape_info = str(outputs[0].shape)  # type: ignore[union-attr]
            raise InferenceError(f"Spark batch inference failed (Shape: {shape_info}): {e}") from e
