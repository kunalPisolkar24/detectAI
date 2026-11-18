import math

from src.domain.exceptions import InvalidInputError
from src.domain.models import DocumentChunk, DocumentScore, HighlightSpan


class ResultAggregator:
    def __init__(self, chunk_stride: int, label_threshold: float = 0.5):
        if not isinstance(chunk_stride, int) or chunk_stride <= 0:
            raise ValueError("chunk_stride must be an int >0")
        if not isinstance(label_threshold, (int, float)) or not 0 < label_threshold < 1:
            raise ValueError("label_threshold must be in (0,1)")
        self.chunk_stride = chunk_stride
        self.label_threshold = float(label_threshold)

    def aggregate(self, chunks: list[DocumentChunk], probabilities: list[float], total_chars: int) -> DocumentScore:
        if not chunks or not probabilities or len(chunks) != len(probabilities):
            raise InvalidInputError("Chunks and probabilities must be non-empty and aligned")
        if not isinstance(total_chars, int) or total_chars < 0:
            raise InvalidInputError("total_chars must be >=0")
        for p in probabilities:
            if not isinstance(p, (int, float)) or not math.isfinite(p) or not 0.0 <= p <= 1.0:
                raise InvalidInputError(f"Probability {p!r} must be finite in [0,1]")
        for c in chunks:
            if not isinstance(c.token_count, int) or c.token_count <= 0:
                raise InvalidInputError("chunk token_count must be >0")
            if c.char_start < 0 or c.char_end <= c.char_start:
                raise InvalidInputError("chunk offsets invalid")

        total_weight = 0
        weighted_sum = 0.0

        for i, (chunk, probability) in enumerate(zip(chunks, probabilities)):
            if i == 0:
                weight = chunk.token_count
            else:
                weight = min(self.chunk_stride, chunk.token_count)

            total_weight += weight
            weighted_sum += weight * probability

        if total_weight <= 0:
            raise InvalidInputError("total_weight must be >0")
        ai_probability = weighted_sum / total_weight

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
        boundaries = sorted({b for chunk in chunks for b in (chunk.char_start, chunk.char_end)})
        pos_index = {pos: i for i, pos in enumerate(boundaries)}
        delta_count = [0] * len(boundaries)
        delta_sum = [0.0] * len(boundaries)
        for chunk, prob in zip(chunks, probabilities):
            delta_count[pos_index[chunk.char_start]] += 1
            delta_count[pos_index[chunk.char_end]] -= 1
            delta_sum[pos_index[chunk.char_start]] += prob
            delta_sum[pos_index[chunk.char_end]] -= prob

        spans: list[HighlightSpan] = []
        active_count = 0
        active_sum = 0.0
        for k in range(len(boundaries) - 1):
            active_count += delta_count[k]
            active_sum += delta_sum[k]
            if active_count == 0:
                continue
            self._append_span(spans, boundaries[k], boundaries[k + 1], active_sum / active_count)
        return spans

    def _append_span(
        self,
        spans: list[HighlightSpan],
        start: int,
        end: int,
        ai_probability: float,
    ) -> None:
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
            return

        spans.append(
            HighlightSpan(
                char_start=start,
                char_end=end,
                ai_probability=ai_probability,
            )
        )

    def _label_for(self, ai_probability: float) -> str:
        return "AI" if ai_probability >= self.label_threshold else "Human"
