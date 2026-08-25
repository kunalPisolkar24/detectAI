from unittest.mock import MagicMock

from app.domain.extraction.strategies import ExtractionResult


def test_extract_missing_file_returns_422(client):
    response = client.post("/extract")

    assert response.status_code == 422


def test_extract_non_multipart_body_returns_422(client, mocker):
    mocker.patch("app.api.v1.endpoints.extract.validate_upload", return_value="text/plain")
    mocker.patch(
        "app.domain.extraction.service.ExtractionService.process_file",
        return_value=MagicMock(),
    )

    response = client.post("/extract", json={"file": "not-multipart"})

    assert response.status_code == 422


def test_extract_filename_none_falls_back_to_unknown(client, mocker):
    mocker.patch("app.api.deps.magic.from_buffer", return_value="text/plain")
    mocker.patch(
        "app.domain.extraction.service.ExtractionService.process_file",
        return_value=ExtractionResult(text="body"),
    )

    body = (
        "--BND\r\n"
        'Content-Disposition: form-data; name="file"; filename=""\r\n'
        "Content-Type: text/plain\r\n"
        "\r\n"
        "content\r\n"
        "--BND--\r\n"
    ).encode()
    response = client.post(
        "/extract",
        content=body,
        headers={"Content-Type": "multipart/form-data; boundary=BND"},
    )

    assert response.status_code == 200
    assert response.json()["filename"] == "unknown"
