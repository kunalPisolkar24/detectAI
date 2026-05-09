import os
from unittest.mock import patch
from app.core.metrics import render_metrics

def test_render_metrics_single_process():
    with patch.dict(os.environ, clear=True):
        payload, content_type = render_metrics()
        assert content_type == "text/plain; version=0.0.4; charset=utf-8"
        assert b"http_requests_total" in payload

def test_render_metrics_multi_process(mocker, tmp_path):
    # Set the env var to a temporary directory
    mocker.patch.dict(os.environ, {"PROMETHEUS_MULTIPROC_DIR": str(tmp_path)})
    
    # render_metrics should use CollectorRegistry and MultiProcessCollector
    # We can just verify it doesn't crash and returns the correct content type
    payload, content_type = render_metrics()
    assert content_type == "text/plain; version=0.0.4; charset=utf-8"
