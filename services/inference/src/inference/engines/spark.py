import numpy as np
from src.application.ports.outbound.inference import ISyncBatchInferenceEngine
from src.inference.engines.base import BaseEngine
from src.domain.exceptions import InferenceError

class SparkEngine(ISyncBatchInferenceEngine, BaseEngine):
    def __init__(self, resources):
        self.session, self.tokenizer = resources
        self.input_name = self.session.get_inputs()[0].name

    def predict_batch(self, texts: list[str]) -> list[float]:
        outputs = None
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
            if outputs is not None and isinstance(outputs, list) and len(outputs) > 0 and hasattr(outputs[0], 'shape'):
                shape_info = str(outputs[0].shape)
            
            raise InferenceError(f"Spark batch inference failed (Shape: {shape_info}): {str(e)}")
