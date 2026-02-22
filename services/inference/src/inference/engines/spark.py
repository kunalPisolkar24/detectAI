import numpy as np
from src.core.interfaces import IInferenceEngine
from src.inference.engines.base import BaseEngine
from src.core.exceptions import InferenceError

class SparkEngine(IInferenceEngine, BaseEngine):
    def __init__(self, resources):
        self.session, self.tokenizer = resources
        self.input_name = self.session.get_inputs()[0].name

    def predict(self, text: str) -> float:
        return self.predict_batch([text])[0]

    def predict_batch(self, texts: list[str]) -> list[float]:
        try:
            vectorized = self.tokenizer.transform(texts).toarray().astype(np.float32)
            
            outputs = self.session.run(None, {self.input_name: vectorized})
            raw_output = outputs[0] 
            if raw_output.ndim == 1:
                return raw_output.astype(float).tolist()
            

            if raw_output.shape[1] == 1:
                return raw_output.flatten().astype(float).tolist()
            
            probs = self.softmax(raw_output)
            
            ai_probs = probs[:, 1]
            return ai_probs.astype(float).tolist()

        except Exception as e:
            shape_info = "Unknown"
            if 'outputs' in locals() and len(outputs) > 0:
                shape_info = str(outputs[0].shape)
            
            raise InferenceError(f"Spark batch inference failed (Shape: {shape_info}): {str(e)}")