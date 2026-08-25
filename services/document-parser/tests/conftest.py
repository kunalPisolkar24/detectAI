import pytest
from fastapi.testclient import TestClient
from prometheus_client.metrics import MetricWrapperBase

import app.core.metrics as metrics_module
from app.main import app as fastapi_app


def _clear_metric(metric) -> None:
    try:
        metric.clear()
    except AttributeError:
        metric._metrics = {}


def _metric_families():
    for name in dir(metrics_module):
        obj = getattr(metrics_module, name)
        if isinstance(obj, MetricWrapperBase):
            yield obj


@pytest.fixture(autouse=True)
def clean_prometheus_registry():
    for metric in _metric_families():
        _clear_metric(metric)
    metrics_module._pool_busy_tasks = 0
    yield
    for metric in _metric_families():
        _clear_metric(metric)
    metrics_module._pool_busy_tasks = 0


@pytest.fixture(scope="session")
def app():
    return fastapi_app


@pytest.fixture(scope="session")
def client(app):
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def pool_unavailable(mocker):
    mocker.patch("app.api.v1.endpoints.health.is_process_pool_healthy", return_value=False)
    mocker.patch("app.api.v1.endpoints.health.get_pool_stats", return_value=None)
    mocker.patch("app.core.metrics.is_process_pool_healthy", return_value=False)
    mocker.patch("app.core.metrics.get_pool_stats", return_value=None)


@pytest.fixture
def sample_txt() -> bytes:
    return b"Shared fixture text for the document parser test suite."


@pytest.fixture
def sample_pdf_path(tmp_path):
    import fitz

    pdf_path = tmp_path / "sample.pdf"
    with fitz.open() as doc:
        page = doc.new_page(width=612, height=792)
        page.insert_text((72, 500), "Shared fixture body line", fontname="helv", fontsize=11)
        doc.save(pdf_path)
    return str(pdf_path)


@pytest.fixture
def sample_docx_path(tmp_path):
    import zipfile

    docx_path = tmp_path / "sample.docx"
    document_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        "<w:body><w:p><w:r><w:t>Shared fixture paragraph</w:t></w:r></w:p></w:body>"
        "</w:document>"
    )
    content_types = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
        "</Types>"
    )
    root_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
        "</Relationships>"
    )
    with zipfile.ZipFile(docx_path, "w") as archive:
        archive.writestr("[Content_Types].xml", content_types)
        archive.writestr("_rels/.rels", root_rels)
        archive.writestr("word/document.xml", document_xml)
    return str(docx_path)
