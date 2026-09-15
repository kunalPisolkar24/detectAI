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
            vectorized = self.tokenizer.transform(texts).toarray().astype(np.float32)
            outputs = self.session.run(None, {self.input_name: vectorized})
            return self.decode_logits(outputs[0])
        except InferenceError:
            raise
        except Exception as e:
            shape_info = "Unknown"
            if outputs is not None and isinstance(outputs, list) and len(outputs) > 0 and hasattr(outputs[0], "shape"):
                shape_info = str(outputs[0].shape)  # type: ignore[union-attr]
            raise InferenceError(f"Spark batch inference failed (Shape: {shape_info}): {e}") from e
