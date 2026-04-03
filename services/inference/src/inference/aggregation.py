from src.inference.document_types import DocumentChunk, DocumentScore


class ResultAggregator:
    def aggregate(self, chunks: list[DocumentChunk], probabilities: list[float], total_chars: int) -> DocumentScore:
        if not chunks or not probabilities or len(chunks) != len(probabilities):
            raise ValueError("Chunks and probabilities must be non-empty and aligned")

        total_weight = sum(chunk.token_count for chunk in chunks)
        weighted_sum = sum(chunk.token_count * probability for chunk, probability in zip(chunks, probabilities))
        ai_probability = weighted_sum / total_weight if total_weight else probabilities[-1]

        return DocumentScore(
            ai_probability=ai_probability,
            total_chunks=len(chunks),
            total_chars=total_chars,
        )
