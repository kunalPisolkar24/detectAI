import numpy as np
from src.core.interfaces import IInferenceEngine
from src.inference.engines.base import BaseEngine
from src.core.exceptions import InferenceError

class FlareEngine(IInferenceEngine, BaseEngine):
    def __init__(self, resources):
        self.session, self.tokenizer = resources

    def predict(self, text: str) -> float:
        return self.predict_batch([text])[0]

    def predict_batch(self, texts: list[str]) -> list[float]:
        try:
            inputs = self.tokenizer(
                texts, return_tensors="np", padding=True, truncation=True, max_length=256
            )
            
            ort_inputs = {
                k: v.astype(np.int64) for k, v in inputs.items() 
                if k in [x.name for x in self.session.get_inputs()]
            }
            
            logits = self.session.run(None, ort_inputs)[0]
            probs = self.softmax(logits)
            return [float(p[1]) for p in probs]
        except Exception as e:
            raise InferenceError(f"Flare batch inference failed: {str(e)}")