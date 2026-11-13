"""The preparation facade: admission, tokenization and windowing for one model."""

from .chunk import Chunk, PreparedDocument
from .tokenizer import Encoding, Tokenizer

MIN_SEQUENCE_LENGTH = 64


class DocumentPreprocessor:
    """Admission, tokenization and windowing for one model."""

    def __init__(
        self,
        tokenizer: Tokenizer,
        chunk_token_limit: int,
        model_max_sequence_length: int,
        max_text_chars: int,
    ) -> None:
        self._tokenizer = tokenizer
        self._chunk_token_limit = chunk_token_limit
        self._model_max_sequence_length = model_max_sequence_length
        self._max_text_chars = max_text_chars
        window = min(chunk_token_limit, model_max_sequence_length)
        if window < MIN_SEQUENCE_LENGTH:
            raise ValueError(
                f"the chunk window is {window} tokens; at least {MIN_SEQUENCE_LENGTH} are needed"
            )
        self._window_tokens = window
        self._content_tokens = window - tokenizer.special_token_count

    def prepare(self, text: str) -> PreparedDocument:
        """Admit the submission, tokenize it once, and window it."""
        raise NotImplementedError

    def split(self, text: str, encoding: Encoding) -> tuple[Chunk, ...]:
        """Cut the token stream at soft boundaries into contiguous, non-overlapping chunks."""
        raise NotImplementedError
