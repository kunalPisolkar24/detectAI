from src.domain.models import DocumentChunk


def build_sliding_chunks(
    text: str,
    offsets: list[tuple[int, int]],
    chunk_size: int,
    stride: int,
) -> list[DocumentChunk]:
    chunks: list[DocumentChunk] = []
    idx = 0
    for start in range(0, len(offsets), stride):
        window = offsets[start : start + chunk_size]
        if not window:
            break
        char_start, char_end = window[0][0], window[-1][1]
        if char_end <= char_start:
            continue
        chunks.append(
            DocumentChunk(
                index=idx,
                text=text[char_start:char_end],
                token_count=len(window),
                char_start=char_start,
                char_end=char_end,
            )
        )
        idx += 1
        if start + chunk_size >= len(offsets):
            break
    return chunks


def validate_chunk_params(chunk_size: int, stride: int, max_global_tokens: int) -> None:
    if not isinstance(chunk_size, int) or chunk_size <= 0:
        raise ValueError("chunk_size must be an int >0")
    if not isinstance(stride, int) or stride <= 0:
        raise ValueError("stride must be an int >0")
    if not isinstance(max_global_tokens, int) or max_global_tokens <= 0:
        raise ValueError("max_global_tokens must be an int >0")
