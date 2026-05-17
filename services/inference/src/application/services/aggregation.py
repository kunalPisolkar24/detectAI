from src.domain.models import DocumentChunk, DocumentScore, HighlightSpan

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
            highlight_spans=self._build_highlight_spans(chunks, probabilities),
        )

    def _build_highlight_spans(
        self,
        chunks: list[DocumentChunk],
        probabilities: list[float],
    ) -> list[HighlightSpan]:
        boundaries = sorted({
            boundary
            for chunk in chunks
            for boundary in (chunk.char_start, chunk.char_end)
        })

        spans: list[HighlightSpan] = []
        for start, end in zip(boundaries, boundaries[1:]):
            if end <= start:
                continue

            overlapping_probs = [
                probability
                for chunk, probability in zip(chunks, probabilities)
                if chunk.char_start < end and chunk.char_end > start
            ]
            if not overlapping_probs:
                continue

            ai_probability = sum(overlapping_probs) / len(overlapping_probs)

            if spans and spans[-1].char_end == start and self._label_for(spans[-1].ai_probability) == self._label_for(ai_probability):
                previous = spans[-1]
                previous_length = previous.char_end - previous.char_start
                current_length = end - start
                combined_length = previous_length + current_length
                combined_probability = (
                    (previous.ai_probability * previous_length) + (ai_probability * current_length)
                ) / combined_length
                spans[-1] = HighlightSpan(
                    char_start=previous.char_start,
                    char_end=end,
                    ai_probability=combined_probability,
                )
                continue

            spans.append(
                HighlightSpan(
                    char_start=start,
                    char_end=end,
                    ai_probability=ai_probability,
                )
            )

        return spans

    def _label_for(self, ai_probability: float) -> str:
        return "AI" if ai_probability >= 0.5 else "Human"
