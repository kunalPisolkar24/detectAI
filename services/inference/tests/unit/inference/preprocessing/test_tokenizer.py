"""The tokenizer port and its adapter: one call, no special tokens, one span per token."""

from dataclasses import FrozenInstanceError
from pathlib import Path
from typing import Any

import pytest

from app.inference.preprocessing import DocumentPreprocessor, Encoding, FastTokenizer

_SERVICE = Path(__file__).resolve().parents[4]
_FLARE = _SERVICE / "models" / "flare" / "onnx" / "fp32"
_SPARK = _SERVICE / "models" / "spark" / "onnx" / "fp16"

requires_artifacts = pytest.mark.skipif(
    not _FLARE.exists(), reason="the pulled artifacts are not on this host"
)


class StubTokenizer:
    """Stands in for the HF tokenizer: the attributes and the one call the adapter makes."""

    cls_token_id = 50281
    sep_token_id = 50282

    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    def num_special_tokens_to_add(self, pair: bool = False) -> int:
        return 2

    def __call__(self, text: str, **kwargs: Any) -> dict[str, list[Any]]:
        self.calls.append({"text": text, **kwargs})
        return {"input_ids": [10, 11], "offset_mapping": [(0, 3), (3, 7)]}


def test_the_adapter_holds_its_injected_tokenizer() -> None:
    tokenizer = StubTokenizer()

    assert FastTokenizer(tokenizer)._tokenizer is tokenizer


def test_the_adapter_reads_the_special_tokens() -> None:
    adapter = FastTokenizer(StubTokenizer())

    assert adapter.cls_token_id == 50281
    assert adapter.sep_token_id == 50282
    assert adapter.special_token_count == 2


def test_the_adapter_calls_the_tokenizer_once_without_special_tokens() -> None:
    tokenizer = StubTokenizer()
    adapter = FastTokenizer(tokenizer)

    encoding = adapter.encode("some text")

    assert len(tokenizer.calls) == 1
    call = tokenizer.calls[0]
    assert call["text"] == "some text"
    assert call["add_special_tokens"] is False
    assert call["return_offsets_mapping"] is True
    assert call["truncation"] is False
    assert encoding.ids == (10, 11)
    assert encoding.offsets == ((0, 3), (3, 7))


def test_an_encoding_is_frozen_pure_data() -> None:
    encoding = Encoding(ids=(10, 11), offsets=((0, 3), (3, 7)))

    assert encoding.ids == (10, 11)
    assert encoding.offsets == ((0, 3), (3, 7))
    with pytest.raises(FrozenInstanceError):
        encoding.ids = (1,)  # type: ignore[misc]


@requires_artifacts
def test_the_shipped_tokenizer_agrees_with_the_text() -> None:
    from transformers import AutoTokenizer

    tokenizer = AutoTokenizer.from_pretrained(str(_FLARE), local_files_only=True)
    adapter = FastTokenizer(tokenizer)
    text = "The first sentence. And the second one!\nA third line here."

    encoding = adapter.encode(text)

    assert adapter.special_token_count == 2
    assert len(encoding.ids) == len(encoding.offsets)
    assert encoding.offsets[0][0] == 0
    assert encoding.offsets[-1][1] == len(text)
    assert all(
        encoding.offsets[index][1] == encoding.offsets[index + 1][0]
        for index in range(len(encoding.offsets) - 1)
    )
    with_specials = tokenizer(text, add_special_tokens=True)["input_ids"]
    assert len(encoding.ids) == len(with_specials) - 2


@requires_artifacts
def test_every_chunk_decodes_back_to_the_text_it_came_from() -> None:
    from transformers import AutoTokenizer

    tokenizer = AutoTokenizer.from_pretrained(str(_FLARE), local_files_only=True)
    preprocessor = DocumentPreprocessor(
        FastTokenizer(tokenizer),
        chunk_token_limit=64,
        model_max_sequence_length=8192,
        max_text_chars=1_000_000,
    )
    text = (
        "The first sentence carries a little more than the second one does. "
        "Then a line break lands here.\n"
        "And a last sentence closes the document."
    ) * 6

    document = preprocessor.prepare(text)

    assert len(document.chunks) > 1
    for chunk in document.chunks:
        decoded = tokenizer.decode(
            chunk.token_ids[1:-1], clean_up_tokenization_spaces=False
        )
        assert decoded == text[chunk.char_start : chunk.char_end]


@requires_artifacts
def test_both_shipped_tokenizers_declare_the_same_special_tokens() -> None:
    from transformers import AutoTokenizer

    for path in (_FLARE, _SPARK):
        tokenizer = AutoTokenizer.from_pretrained(str(path), local_files_only=True)
        adapter = FastTokenizer(tokenizer)

        assert adapter.special_token_count == 2
        assert adapter.cls_token_id != adapter.sep_token_id
