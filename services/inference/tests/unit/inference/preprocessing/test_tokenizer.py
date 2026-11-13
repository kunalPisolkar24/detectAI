"""The tokenizer port and its adapter: the special tokens read through, the encode call pending."""

from dataclasses import FrozenInstanceError

import pytest

from app.inference.preprocessing import Encoding, FastTokenizer


class StubTokenizer:
    """Stands in for the HF tokenizer: the three attributes the adapter reads."""

    cls_token_id = 50281
    sep_token_id = 50282

    def num_special_tokens_to_add(self, pair: bool = False) -> int:
        return 2


def test_an_encode_request_is_pending() -> None:
    with pytest.raises(NotImplementedError):
        FastTokenizer(StubTokenizer()).encode("some text")


def test_the_adapter_holds_its_injected_tokenizer() -> None:
    tokenizer = StubTokenizer()

    assert FastTokenizer(tokenizer)._tokenizer is tokenizer


def test_the_adapter_reads_the_special_tokens() -> None:
    adapter = FastTokenizer(StubTokenizer())

    assert adapter.cls_token_id == 50281
    assert adapter.sep_token_id == 50282
    assert adapter.special_token_count == 2


def test_an_encoding_is_frozen_pure_data() -> None:
    encoding = Encoding(ids=(10, 11), offsets=((0, 3), (3, 7)))

    assert encoding.ids == (10, 11)
    assert encoding.offsets == ((0, 3), (3, 7))
    with pytest.raises(FrozenInstanceError):
        encoding.ids = (1,)  # type: ignore[misc]
