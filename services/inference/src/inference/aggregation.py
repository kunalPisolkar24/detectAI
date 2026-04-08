from src.inference.document_types import DocumentChunk, DocumentScore

class ResultAggregator:
    def __init__(self, chunk_stride: int):
        self.chunk_stride = max(1, chunk_stride)

    def aggregate(self, chunks: list[DocumentChunk], probabilities: list[float], total_chars: int) -> DocumentScore:
        if not chunks or not probabilities or len(chunks) != len(probabilities):
            raise ValueError("Chunks and probabilities must be non-empty and aligned")

        total_weight = 0
        weighted_sum = 0
        
        for i, (chunk, probability) in enumerate(zip(chunks, probabilities)):
            if i == 0:
                weight = chunk.token_count
            else:
                weight = min(self.chunk_stride, chunk.token_count)
                
            total_weight += weight
            weighted_sum += weight * probability
            
        ai_probability = weighted_sum / total_weight if total_weight else probabilities[-1]

        return DocumentScore(
            ai_probability=ai_probability,
            total_chunks=len(chunks),
            total_chars=total_chars,
        )
