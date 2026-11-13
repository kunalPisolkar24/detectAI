"""The results of one prepared submission: the chunk and the document that carries them."""

from dataclasses import dataclass


@dataclass(frozen=True)
class Chunk:
    """One analysable window: the token IDs to feed the model and the text span they came from."""

    index: int
    token_ids: tuple[int, ...]  # includes [CLS] ... [SEP]
    char_start: int  # Unicode scalar offset into the request text
    char_end: int

    @property
    def token_count(self) -> int:
        """The sequence length the model sees, special tokens included."""
        return len(self.token_ids)


@dataclass(frozen=True)
class PreparedDocument:
    """One prepared submission: the document's totals, plus the chunks it was windowed into."""

    total_chars: int
    total_tokens: int
    chunks: tuple[Chunk, ...]
