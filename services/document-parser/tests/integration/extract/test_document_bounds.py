"""Parse-time rejections through the real app under shrunken bounds.

A module-scoped client booted with tiny env bounds makes the 413 paths
reachable with crafted bytes; the typed strategy rejections route exactly
as http.md draws them — too-large names its limit, corrupt keeps the
generic detail — and admitted rows extract through the same boot.
"""

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from tests.support.documents import (
    minimal_docx_bytes,
    minimal_pdf_bytes,
    positioned_pdf_bytes,
    surrogate_zip_bytes,
)

from .conftest import KEY

_PAGES_LIMIT = "2"
_SIZE_LIMIT = "500"


@pytest.fixture(scope="module")
def bounded_client() -> Iterator[TestClient]:
    patch = pytest.MonkeyPatch()
    patch.setenv("ENV_TYPE", "dev")
    patch.setenv("API_KEY", KEY)
    patch.setenv("MAX_PDF_PAGES", _PAGES_LIMIT)
    patch.setenv("DOCX_MAX_UNCOMPRESSED_BYTES", _SIZE_LIMIT)
    from app.main import app as production_app

    with TestClient(production_app) as test_client:
        yield test_client
    patch.undo()


def test_an_oversized_pdf_names_its_page_limit(bounded_client: TestClient) -> None:
    response = bounded_client.post(
        "/api/v1/extract",
        headers={"x-api-key": KEY},
        files={"file": ("big.pdf", minimal_pdf_bytes(3), "application/pdf")},
    )

    assert response.status_code == 413
    assert response.json() == {"detail": "the pdf exceeds the 2-page limit"}


def test_an_oversized_docx_names_its_uncompressed_limit(bounded_client: TestClient) -> None:
    response = bounded_client.post(
        "/api/v1/extract",
        headers={"x-api-key": KEY},
        files={
            "file": (
                "big.docx",
                minimal_docx_bytes({"word/assets/blob.bin": b"z" * 1_000}),
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            )
        },
    )

    assert response.status_code == 413
    assert response.json() == {"detail": "the docx exceeds the 500-byte uncompressed limit"}


@pytest.mark.parametrize(
    "branded_garbage", [b"%PDF-1.7 no container behind the signature", b"%PDF-",]
)
def test_branded_dead_pdf_bytes_stay_the_generic_422(bounded_client: TestClient, branded_garbage: bytes) -> None:
    response = bounded_client.post(
        "/api/v1/extract",
        headers={"x-api-key": KEY},
        files={"file": ("dead.pdf", branded_garbage, "application/pdf")},
    )

    assert response.status_code == 422
    assert response.json() == {"detail": "corrupt or unsupported upload"}


def test_an_impersonating_zip_stays_the_generic_422(bounded_client: TestClient) -> None:
    impostor = surrogate_zip_bytes(["ppt/presentation.xml", "docProps/core.xml"])

    response = bounded_client.post(
        "/api/v1/extract",
        headers={"x-api-key": KEY},
        files={
            "file": (
                "fake.docx",
                impostor,
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            )
        },
    )

    assert response.status_code == 422
    assert response.json() == {"detail": "corrupt or unsupported upload"}


def test_admitted_rows_extract_through_the_pipeline(bounded_client: TestClient) -> None:
    pdf_text = "doc parser probe pdf line"
    pdf_at_the_bound = bounded_client.post(
        "/api/v1/extract",
        headers={"x-api-key": KEY},
        files={"file": ("ok.pdf", positioned_pdf_bytes([[(400.0, pdf_text)]]), "application/pdf")},
    )
    plain_text = bounded_client.post(
        "/api/v1/extract",
        headers={"x-api-key": KEY},
        files={"file": ("ok.txt", b"body", "text/plain")},
    )

    assert pdf_at_the_bound.status_code == 200
    assert pdf_at_the_bound.json() == {
        "filename": "ok.pdf",
        "content_type": "application/pdf",
        "text_length": len(pdf_text),
        "text": pdf_text,
        "truncated": False,
    }
    assert plain_text.status_code == 200
    assert plain_text.json() == {
        "filename": "ok.txt",
        "content_type": "text/plain",
        "text_length": 4,
        "text": "body",
        "truncated": False,
    }
