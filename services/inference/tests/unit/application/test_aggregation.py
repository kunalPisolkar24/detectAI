import random
from itertools import pairwise

import pytest

from src.application.services.aggregation import ResultAggregator
from src.domain.models import DocumentChunk


def _brute_force_spans(chunks, probs, threshold=0.5):
    def label(p):
        return "AI" if p >= threshold else "Human"

    points = sorted({b for c in chunks for b in (c.char_start, c.char_end)})
    segments = []
    for start, end in pairwise(points):
        overlapping = [p for c, p in zip(chunks, probs) if c.char_start < end and c.char_end > start]
        if overlapping:
            segments.append((start, end, sum(overlapping) / len(overlapping)))

    merged = []
    for start, end, prob in segments:
        if merged and merged[-1][1] == start and label(merged[-1][2]) == label(prob):
            prev_start, _, prev_prob = merged[-1]
            prev_len = merged[-1][1] - prev_start
            cur_len = end - start
            merged[-1] = (
                prev_start,
                end,
                (prev_prob * prev_len + prob * cur_len) / (prev_len + cur_len),
            )
        else:
            merged.append((start, end, prob))
    return merged


def _random_chunks(rng, n):
    chunks = []
    for i in range(n):
        start = rng.randint(0, 12)
        end = rng.randint(start + 1, 16)
        chunks.append(
            DocumentChunk(index=i, text="x" * (end - start), token_count=1, char_start=start, char_end=end)
        )
    return chunks


def test_highlight_spans_match_brute_force():
    rng = random.Random(1234)
    aggregator = ResultAggregator(chunk_stride=2)

    for _ in range(200):
        n = rng.randint(1, 8)
        chunks = _random_chunks(rng, n)
        probs = [rng.random() for _ in range(n)]

        expected = _brute_force_spans(chunks, probs)
        actual = aggregator._build_highlight_spans(chunks, probs)

        assert [(s.char_start, s.char_end) for s in actual] == [(s, e) for s, e, _ in expected]
        for span, (_, _, prob) in zip(actual, expected):
            assert span.ai_probability == pytest.approx(prob, rel=1e-9)


def test_highlight_spans_empty_input():
    assert ResultAggregator(chunk_stride=2)._build_highlight_spans([], []) == []


def test_highlight_spans_single_chunk():
    chunks = [DocumentChunk(index=0, text="hello", token_count=1, char_start=0, char_end=5)]

    spans = ResultAggregator(chunk_stride=2)._build_highlight_spans(chunks, [0.7])

    assert len(spans) == 1
    assert (spans[0].char_start, spans[0].char_end) == (0, 5)
    assert spans[0].ai_probability == pytest.approx(0.7)
