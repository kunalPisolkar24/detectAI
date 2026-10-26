"""The boot's observability shape on the real lifespan: a dev boot with no
OTLP endpoint installs the null object — one state name, fully inert."""

from fastapi.testclient import TestClient

from app.observability import NullObservability


def test_a_dev_boot_installs_the_null_observability(client: TestClient) -> None:
    from app.main import app as production_app

    assert isinstance(production_app.state.observability, NullObservability)
