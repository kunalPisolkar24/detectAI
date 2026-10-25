"""The input boundary through the production app: what a caller gets for
each admission verdict, with real routing, real lifespan config boot, and
the strategy registry behind the route.

http.md settles the wire: 501 remains the validated-upload answer until
the pipeline lands; 413 names the bound; 415 names the sniffed MIME while
the declared Content-Type is metadata only; and the generic 422 covers a
missing `file` field and a malformed multipart body alike — unit tables
pin the registry, this suite pins what a caller actually gets.
"""

import pytest
from fastapi.testclient import TestClient

from tests.support.documents import minimal_docx_bytes, minimal_pdf_bytes

from .conftest import KEY

_INTERIM = {"detail": "extraction pipeline not implemented yet"}
_GENERIC_422 = {"detail": "corrupt or unsupported upload"}

_PDF = minimal_pdf_bytes(1)
_DOCX = minimal_docx_bytes()


@pytest.mark.parametrize(
    ("filename", "body", "declared"),
    [
        ("a.pdf", _PDF, "application/pdf"),
        ("a.docx", _DOCX, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
        ("a.txt", b"\nbody", "text/plain"),
    ],
)
def test_supported_types_reach_the_interim_501(
    client: TestClient, filename: str, body: bytes, declared: str
) -> None:
    response = client.post("/api/v1/extract", headers={"x-api-key": KEY}, files={"file": (filename, body, declared)})

    assert response.status_code == 501
    assert response.json() == _INTERIM


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
    assert guest.status_code == 501


def test_an_oversized_body_rejects_with_the_bound_named(client: TestClient) -> None:
    body = b"x" * (10 * 1024 * 1024 + 1)

    response = client.post(
        "/api/v1/extract", headers={"x-api-key": KEY}, files={"file": ("big.bin", body, "application/octet-stream")}
    )

    assert response.status_code == 413
    assert response.json() == {"detail": "the request body exceeds the 10485760-byte upload limit"}


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


def test_an_empty_file_part_admits_as_text(client: TestClient) -> None:
    response = client.post("/api/v1/extract", headers={"x-api-key": KEY}, files={"file": ("empty.txt", b"", "text/plain")})

    assert response.status_code == 501
    assert response.json() == _INTERIM
