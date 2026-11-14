"""The preparation facade: admission, tokenization and windowing for one model."""

from bisect import bisect_left

from .chunk import Chunk, PreparedDocument
from .errors import InvalidDocument
from .tokenizer import Encoding, Tokenizer

MIN_SEQUENCE_LENGTH = 64

# The characters that end a sentence: the span that ends on one is a cut point.
_SENTENCE_END = ".!?"

# Whitespace and control characters: a submission of nothing else carries no signal.
_BLANK_CHARS = " " + "".join(chr(code) for code in range(0x20)) + "\x7f"


class DocumentPreprocessor:
    """Admission, tokenization and windowing for one model."""

    def __init__(
        self,
        tokenizer: Tokenizer,
        chunk_token_limit: int,
        model_max_sequence_length: int,
        max_text_chars: int,
        chunk_token_overlap: int = 0,
    ) -> None:
        self._tokenizer = tokenizer
        self._chunk_token_limit = chunk_token_limit
        self._model_max_sequence_length = model_max_sequence_length
        self._max_text_chars = max_text_chars
        self._chunk_token_overlap = chunk_token_overlap
        window = min(chunk_token_limit, model_max_sequence_length)
        if window < MIN_SEQUENCE_LENGTH:
            raise ValueError(
                f"the chunk window is {window} tokens; at least {MIN_SEQUENCE_LENGTH} are needed"
            )
        self._window_tokens = window
        self._content_tokens = window - tokenizer.special_token_count - chunk_token_overlap
        if self._content_tokens < 1:
            raise ValueError(
                f"the chunk window is {window} tokens and the tokenizer adds "
                f"{tokenizer.special_token_count} special ones; an overlap of "
                f"{chunk_token_overlap} leaves no room for content "
                f"(at most {window - tokenizer.special_token_count - 1} is usable)"
            )

    @property
    def window_tokens(self) -> int:
        """The sequence length one chunk occupies in the model, special tokens included."""
        return self._window_tokens

    def prepare(self, text: str) -> PreparedDocument:
        """Admit the submission, tokenize it once, and window it."""
        self._admit(text)
        encoding = self._tokenizer.encode(text)
        return PreparedDocument(
            total_chars=len(text),
            total_tokens=len(encoding.ids),
            chunks=self.split(text, encoding),
        )

    def split(self, text: str, encoding: Encoding) -> tuple[Chunk, ...]:
        """Cut the token stream at soft boundaries into non-overlapping scored regions."""
        ids = encoding.ids
        offsets = encoding.offsets
        if not ids:
            return ()
        cuts = self._cut_points(text, offsets)
        chunks: list[Chunk] = []
        start = 0
        while start < len(ids):
            end = min(start + self._content_tokens, len(ids))
            if end < len(ids):
                aligned = self._aligned_cut(cuts, start, end)
                if aligned is not None:
                    end = aligned + 1
            context = ids[max(0, start - self._chunk_token_overlap) : start]
            chunks.append(
                Chunk(
                    index=len(chunks),
                    token_ids=(
                        self._tokenizer.cls_token_id,
                        *context,
                        *ids[start:end],
                        self._tokenizer.sep_token_id,
                    ),
                    context_tokens=len(context),
                    char_start=offsets[start][0],
                    char_end=offsets[end - 1][1],
                )
            )
            start = end
        return tuple(chunks)

    def _admit(self, text: str) -> None:
        """Reject what cannot be analysed; the text itself is never rewritten."""
        if not isinstance(text, str):
            raise InvalidDocument("the submission is not text")
        if not text.strip() or not text.strip(_BLANK_CHARS):
            raise InvalidDocument("the submission carries no analysable text")
        if len(text) > self._max_text_chars:
            raise InvalidDocument(
                f"the submission is {len(text)} characters; "
                f"the bound is {self._max_text_chars}"
            )

    def _cut_points(
        self, text: str, offsets: tuple[tuple[int, int], ...]
    ) -> tuple[int, ...]:
        """The token indices a cut may follow: a sentence end, or the line break before the next token."""
        cuts: list[int] = []
        for index, (start, end) in enumerate(offsets):
            if end > start and text[end - 1] in _SENTENCE_END:
                cuts.append(index)
            elif index + 1 < len(offsets):
                following = offsets[index + 1][0]
                if following < len(text) and text[following] == "\n":
                    cuts.append(index)
        return tuple(cuts)

    def _aligned_cut(self, cuts: tuple[int, ...], start: int, end: int) -> int | None:
        """The last cut inside the window, but only when it lands in the window's upper half."""
        position = bisect_left(cuts, end) - 1
        if position < 0:
            return None
        cut = cuts[position]
        if cut < start or cut - start < self._content_tokens // 2:
            return None
        return cut
