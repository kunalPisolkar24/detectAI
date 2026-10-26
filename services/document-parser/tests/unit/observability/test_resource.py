"""The shared Resource: the three attributes the New Relic dashboards facet."""

from app.observability.resource import build_resource


def test_resource_carries_the_three_dashboard_facets() -> None:
    resource = build_resource("document-parser", "0.1.0", "prod")

    assert resource.attributes["service.name"] == "document-parser"
    assert resource.attributes["service.version"] == "0.1.0"
    assert resource.attributes["deployment.environment.name"] == "prod"
