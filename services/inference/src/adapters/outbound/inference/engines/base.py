import numpy as np

from src.domain.exceptions import InferenceError


class BaseEngine:
    def softmax(self, x: np.ndarray) -> np.ndarray:
        x = np.asarray(x, dtype=np.float64)
        if x.size == 0:
            raise InferenceError("Softmax received empty input")
        if not np.all(np.isfinite(x)):
            raise InferenceError("Softmax received non-finite logits")
        shifted = x - np.max(x, axis=-1, keepdims=True)
        # Clip to avoid exp overflow
        shifted = np.clip(shifted, -50, 50)
        e_x = np.exp(shifted)
        denom = e_x.sum(axis=-1, keepdims=True)
        if np.any(denom == 0) or not np.all(np.isfinite(denom)):
            raise InferenceError("Softmax denominator is zero or non-finite")
        return e_x / denom

    def sigmoid(self, x: np.ndarray) -> np.ndarray:
        x = np.asarray(x, dtype=np.float64)
        return 1 / (1 + np.exp(-np.clip(x, -30, 30)))