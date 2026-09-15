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
        shifted = np.clip(shifted, -50, 50)
        e_x = np.exp(shifted)
        denom = e_x.sum(axis=-1, keepdims=True)
        if np.any(denom == 0) or not np.all(np.isfinite(denom)):
            raise InferenceError("Softmax denominator is zero or non-finite")
        return e_x / denom

    def sigmoid(self, x: np.ndarray) -> np.ndarray:
        x = np.asarray(x, dtype=np.float64)
        return 1 / (1 + np.exp(-np.clip(x, -30, 30)))

    def decode_logits(self, raw: np.ndarray) -> list[float]:
        raw = np.asarray(raw)
        if raw.ndim == 1:
            probs = self.sigmoid(raw)
            return np.clip(probs, 0.0, 1.0).astype(float).tolist()
        if raw.ndim == 2 and raw.shape[1] == 1:
            probs = self.sigmoid(raw.flatten())
            return np.clip(probs, 0.0, 1.0).astype(float).tolist()
        if raw.ndim == 2 and raw.shape[1] == 2:
            probs = self.softmax(raw)
            return np.clip(probs[:, 1], 0.0, 1.0).astype(float).tolist()
        raise InferenceError(f"Unexpected output shape {raw.shape}, expected (N,), (N,1) or (N,2)")