from src.application.services.chunking.bert_chunker import BertTokenChunker
from src.application.services.chunking.planner import ChunkPlanner
from src.application.services.chunking.regex_chunker import RegexTokenChunker


def build_chunk_planner(
    tokenizer, chunk_size: int, stride: int, max_global_tokens: int
) -> ChunkPlanner:
    if callable(tokenizer):
        return ChunkPlanner(BertTokenChunker(tokenizer), chunk_size, stride, max_global_tokens)
    return ChunkPlanner(RegexTokenChunker(), chunk_size, stride, max_global_tokens)
