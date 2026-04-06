from src.inference.document_types import DocumentChunk, DocumentScore
from src.config import settings

class ResultAggregator:
    def aggregate(self, chunks: list[DocumentChunk], probabilities: list[float], total_chars: int) -> DocumentScore:
        if not chunks or not probabilities or len(chunks) != len(probabilities):
            raise ValueError("Chunks and probabilities must be non-empty and aligned")

        total_weight = 0
        weighted_sum = 0
        
        for i, (chunk, probability) in enumerate(zip(chunks, probabilities)):
            if 0 < i < len(chunks) - 1:
                weight = settings.CHUNK_TOKEN_STRIDE
            else:
                weight = chunk.token_count
                
            total_weight += weight
            weighted_sum += weight * probability
            
        ai_probability = weighted_sum / total_weight if total_weight else probabilities[-1]

        return DocumentScore(
            ai_probability=ai_probability,
            total_chunks=len(chunks),
            total_chars=total_chars,
        )
