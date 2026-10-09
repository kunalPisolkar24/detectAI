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

    def warmup(self) -> None:
        n_features = self._resolve_feature_count()
        dummy = np.zeros((1, n_features), dtype=np.float32)
        self.session.run(None, {self.input_name: dummy})

    def _resolve_feature_count(self) -> int:
        try:
            shape = self.session.get_inputs()[0].shape
            if len(shape) >= 2 and isinstance(shape[1], int) and shape[1] > 0:
                return shape[1]
            for attr in ("vocabulary_", "vocabulary"):
                vocab = getattr(self.tokenizer, attr, None)
                if isinstance(vocab, dict) and vocab:
                    return len(vocab)
            get_names = getattr(self.tokenizer, "get_feature_names_out", None)
            if callable(get_names):
                names = get_names()
                if len(names) > 0:
                    return len(names)
        except Exception as e:
            raise InferenceError(f"Spark warmup could not resolve feature count: {e}") from e
        raise InferenceError("Spark warmup could not resolve feature count")
