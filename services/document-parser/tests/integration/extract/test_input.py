"""The input boundary through the production app: what a caller gets for
each verdict, admission through extraction, with real routing, the real
lifespan config boot, and both registries behind the route.

http.md settles the wire: an admitted upload answers 200 with the pipeline
body — the filename is echoed metadata, the sniffed mime is what
`content_type` says; 413 names the bound; 415 names the sniffed MIME while
the declared Content-Type is metadata only; and the generic 422 covers a
missing `file` field, a malformed multipart body, and content that dies
after admission alike — unit tables pin the registries, this suite pins
what a caller actually gets.
"""

import pytest
from fastapi.testclient import TestClient

from app.validation.models import DEFAULT_UPLOAD_LIMIT_BYTES
from tests.support.documents import (
    docx_body_bytes,
    minimal_docx_bytes,
    minimal_pdf_bytes,
    positioned_pdf_bytes,
)

from .conftest import KEY

_GENERIC_422 = {"detail": "corrupt or unsupported upload"}

_PDF_TEXT = "doc parser probe pdf line"
_PDF = positioned_pdf_bytes([[(400.0, _PDF_TEXT)]])  # mid-page: no edge-zone rules may fire
_DOCX = minimal_docx_bytes()  # a body part with no paragraphs extracts empty

# The exact 200 bodies: filename echoed, content_type the sniff, the
# pipeline's cleaned text with its length, and the cap's flag.
_ADMITTED = [
    (
        "a.pdf",
        _PDF,
        "application/pdf",
        {"filename": "a.pdf", "content_type": "application/pdf", "text_length": len(_PDF_TEXT), "text": _PDF_TEXT, "truncated": False},
    ),
    (
        "a.docx",
        _DOCX,
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        {"filename": "a.docx", "content_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "text_length": 0, "text": "", "truncated": False},
    ),
    (
        "a.txt",
        b"\nbody",
        "text/plain",
        {"filename": "a.txt", "content_type": "text/plain", "text_length": 4, "text": "body", "truncated": False},
    ),
]


@pytest.mark.parametrize(("filename", "body", "declared", "expected"), _ADMITTED)
def test_supported_types_answer_with_their_extraction_200_bodies(
    client: TestClient, filename: str, body: bytes, declared: str, expected: dict[str, object]
) -> None:
    response = client.post("/api/v1/extract", headers={"x-api-key": KEY}, files={"file": (filename, body, declared)})

    assert response.status_code == 200
    assert response.json() == expected


def test_a_file_part_without_a_filename_echoes_unknown(client: TestClient) -> None:
    # A crafted part carries filename="" — metadata nobody gave; the wire
    # answers with http.md's default rather than an empty string.
    boundary = "x"
    body = (
        f"--{boundary}\r\n"
        'Content-Disposition: form-data; name="file"; filename=""\r\n'
        "Content-Type: text/plain\r\n"
        "\r\n"
        "body\r\n"
        f"--{boundary}--\r\n"
    ).encode()

    response = client.post(
        "/api/v1/extract",
        headers={"x-api-key": KEY, "Content-Type": f"multipart/form-data; boundary={boundary}"},
        content=body,
    )

    assert response.status_code == 200
    assert response.json() == {"filename": "unknown", "content_type": "text/plain", "text_length": 4, "text": "body", "truncated": False}


def test_the_declared_type_never_wins_over_the_sniff(client: TestClient) -> None:
    impostor = client.post(
        "/api/v1/extract",
        headers={"x-api-key": KEY},
        files={"file": ("fake.pdf", b"\x89PNG\r\n\x1a\n body", "application/pdf")},
    )
    guest = client.post(
        "/api/v1/extract",
        headers={"x-api-key": KEY},
        files={"file": ("fake.txt", _PDF, "text/plain")},
    )

    assert impostor.status_code == 415
    assert impostor.json() == {"detail": "unsupported document type: image/png"}
    # The txt-declared body still extracts as a pdf — and the 200 says pdf.
    assert guest.status_code == 200
    assert guest.json() == {
        "filename": "fake.txt",
        "content_type": "application/pdf",
        "text_length": len(_PDF_TEXT),
        "text": _PDF_TEXT,
        "truncated": False,
    }


def test_an_oversized_body_rejects_with_the_bound_named(client: TestClient) -> None:
    body = b"x" * (DEFAULT_UPLOAD_LIMIT_BYTES + 1)

    response = client.post(
        "/api/v1/extract", headers={"x-api-key": KEY}, files={"file": ("big.bin", body, "application/octet-stream")}
    )

    assert response.status_code == 413
    assert response.json() == {"detail": f"the request body exceeds the {DEFAULT_UPLOAD_LIMIT_BYTES}-byte upload limit"}


def test_a_missing_file_field_shares_the_generic_422(client: TestClient) -> None:
    other_field = client.post(
        "/api/v1/extract", headers={"x-api-key": KEY}, files={"other": ("x.txt", b"body", "text/plain")}
    )
    no_parts = client.post("/api/v1/extract", headers={"x-api-key": KEY})

    assert other_field.status_code == 422
    assert other_field.json() == _GENERIC_422
    assert no_parts.status_code == 422
    assert no_parts.json() == _GENERIC_422


def test_a_malformed_multipart_body_shares_the_generic_422(client: TestClient) -> None:
    response = client.post(
        "/api/v1/extract",
        headers={"x-api-key": KEY, "Content-Type": "multipart/form-data; boundary=x"},
        content=b"\x00\x01 not really multipart",
    )

    assert response.status_code == 422
    assert response.json() == _GENERIC_422


def test_content_failing_after_admission_shares_the_generic_422(client: TestClient) -> None:
    # Both bodies pass admission — the blank pdf is a structurally valid
    # container, the malformed docx xml hides inside a sound zip — so the
    # pipeline is what brands them, and its generic 422 reads like the
    # admission one (a failing file cannot be branded, http.md).
    scanned = minimal_pdf_bytes(1)
    broken_xml = docx_body_bytes("<w:p><w:r><w:t>unclosed")
    responses = [
        client.post("/api/v1/extract", headers={"x-api-key": KEY}, files={"file": ("fake.txt", scanned, "text/plain")}),
        client.post(
            "/api/v1/extract",
            headers={"x-api-key": KEY},
            files={"file": ("broken.docx", broken_xml, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
        ),
    ]

    for response in responses:
        assert response.status_code == 422
        assert response.json() == _GENERIC_422


def test_an_empty_file_part_admits_as_text(client: TestClient) -> None:
    response = client.post("/api/v1/extract", headers={"x-api-key": KEY}, files={"file": ("empty.txt", b"", "text/plain")})

    assert response.status_code == 200
    assert response.json() == {"filename": "empty.txt", "content_type": "text/plain", "text_length": 0, "text": "", "truncated": False}
