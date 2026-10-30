"""The extraction stage through the production route: budget and cap.

test_input drives the real lifespan's spec-default pipeline; these two
rows need runtime knob positions the real boot never serves — a spent
budget and a pinched output cap — so they bolt a hand-built service onto
a throwaway app and drive the same route through it (http.md's request
lifecycle: 200 inside the budget, 504 over it, a cap hit flagging in the
200 body).
"""

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.extract import router as extract_router
from app.config import Settings
from app.extraction import DocumentExtractionService, build_default_extraction_service
from app.observability import NullObservability
from app.validation import build_default_service
from tests.support.documents import positioned_pdf_bytes

from .conftest import KEY

_BUDGET_504 = {"detail": "the processing budget was exceeded"}


def _client_with(service: DocumentExtractionService) -> TestClient:
    """A throwaway front for the same route: the state the lifespan would
    install, minus the lifespan — the boot's config boot is not what these
    rows vary."""
    throwaway = FastAPI()
    throwaway.include_router(extract_router)
    throwaway.state.settings = Settings(api_key=KEY)
    throwaway.state.validation_service = build_default_service()
    throwaway.state.extraction_service = service
    throwaway.state.observability = NullObservability()
    return TestClient(throwaway)


def test_a_spent_budget_answers_the_generic_504() -> None:
    # A zero budget expires before the first page — the widest overshoot
    # any placement gives — and the wire stays generic because the caller
    # cannot learn which page crossed the deadline.
    client = _client_with(build_default_extraction_service(processing_budget_seconds=0.0))
    book = positioned_pdf_bytes([[(400.0, f"page {index} line")] for index in range(3)])

    response = client.post(
        "/api/v1/extract", headers={"x-api-key": KEY}, files={"file": ("book.pdf", book, "application/pdf")}
    )

    assert response.status_code == 504
    assert response.json() == _BUDGET_504


def test_a_pinched_output_cap_truncates_and_flags_the_200() -> None:
    client = _client_with(build_default_extraction_service(output_char_limit=4))

    response = client.post(
        "/api/v1/extract", headers={"x-api-key": KEY}, files={"file": ("cap.txt", b"abcde", "text/plain")}
    )

    assert response.status_code == 200
    # The cap lands mid-token with no marker: `truncated` is the whole
    # honesty channel (http.md decision 6).
    assert response.json() == {
        "filename": "cap.txt",
        "content_type": "text/plain",
        "text_length": 4,
        "text": "abcd",
        "truncated": True,
    }
