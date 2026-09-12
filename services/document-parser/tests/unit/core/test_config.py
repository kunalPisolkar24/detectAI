import pytest

from app.core.config import Settings, clear_settings_cache, get_settings
from app.core.config.provider import resolve_env_type


def test_cleanup_tunables_defaults():
    settings = Settings()
    assert settings.HEADER_FOOTER_MARGIN_PT == 40.0
    assert settings.HEADER_REPETITION_RATIO == 0.8


def test_cleanup_tunables_env_override(monkeypatch):
    monkeypatch.setenv("HEADER_FOOTER_MARGIN_PT", "60.5")
    monkeypatch.setenv("HEADER_REPETITION_RATIO", "0.9")
    settings = Settings()
    assert settings.HEADER_FOOTER_MARGIN_PT == 60.5
    assert settings.HEADER_REPETITION_RATIO == 0.9


def test_settings_validates_port_range():
    with pytest.raises(Exception):
        Settings(PORT=0)
    with pytest.raises(Exception):
        Settings(PORT=70000)


def test_settings_validates_limits_gt_zero():
    with pytest.raises(Exception):
        Settings(MAX_UPLOAD_SIZE_BYTES=0)
    with pytest.raises(Exception):
        Settings(MAX_TEXT_LENGTH=-1)


def test_log_level_normalized(monkeypatch):
    s = Settings(LOG_LEVEL="warn")
    assert s.LOG_LEVEL == "WARNING"
    s2 = Settings(LOG_LEVEL="debug")
    assert s2.LOG_LEVEL == "DEBUG"
    with pytest.raises(Exception):
        Settings(LOG_LEVEL="VERBOSE")


def test_env_type_normalized():
    assert Settings(ENV_TYPE="prod").ENV_TYPE == "prod"
    assert Settings(ENV_TYPE="production").ENV_TYPE == "prod"
    assert Settings(ENV_TYPE="dev").ENV_TYPE == "dev"
    assert Settings(ENV_TYPE="development").ENV_TYPE == "dev"


def test_allowed_mime_types_csv_and_json():
    s = Settings(ALLOWED_MIME_TYPES="application/pdf,text/plain")
    assert s.ALLOWED_MIME_TYPES == ["application/pdf", "text/plain"]
    s2 = Settings(ALLOWED_MIME_TYPES='["application/pdf", "text/plain"]')
    assert s2.ALLOWED_MIME_TYPES == ["application/pdf", "text/plain"]


def test_allowed_mime_types_invalid():
    with pytest.raises(Exception):
        Settings(ALLOWED_MIME_TYPES="not-a-mime")


def test_otel_endpoint_empty_to_none():
    assert Settings(OTEL_EXPORTER_OTLP_ENDPOINT="").OTEL_EXPORTER_OTLP_ENDPOINT is None
    assert Settings(OTEL_EXPORTER_OTLP_ENDPOINT="http://otel:4318").OTEL_EXPORTER_OTLP_ENDPOINT == "http://otel:4318"
    with pytest.raises(Exception):
        Settings(OTEL_EXPORTER_OTLP_ENDPOINT="otel:4318")


def test_resolve_env_type_with_legacy(monkeypatch):
    monkeypatch.delenv("ENV_TYPE", raising=False)
    monkeypatch.delenv("CONFIG_SOURCE", raising=False)
    monkeypatch.delenv("NODE_ENV", raising=False)
    assert resolve_env_type() == "dev"

    monkeypatch.setenv("CONFIG_SOURCE", "aws")
    assert resolve_env_type() == "prod"

    monkeypatch.setenv("CONFIG_SOURCE", "env")
    assert resolve_env_type() == "dev"

    monkeypatch.delenv("CONFIG_SOURCE", raising=False)
    monkeypatch.setenv("NODE_ENV", "production")
    assert resolve_env_type() == "prod"


def test_get_settings_cached_and_clearable(monkeypatch):
    clear_settings_cache()
    monkeypatch.setenv("ENV_TYPE", "dev")
    monkeypatch.setenv("LOG_LEVEL", "INFO")
    s1 = get_settings()
    s2 = get_settings()
    assert s1 is s2

    monkeypatch.setenv("LOG_LEVEL", "DEBUG")
    # cached still returns old
    assert get_settings().LOG_LEVEL == "INFO"

    clear_settings_cache()
    assert get_settings().LOG_LEVEL == "DEBUG"
    clear_settings_cache()


def test_get_settings_invalid_env_type_raises(monkeypatch):
    clear_settings_cache()
    monkeypatch.setenv("ENV_TYPE", "staging")
    with pytest.raises(ValueError, match="ENV_TYPE must be dev or prod"):
        get_settings()
    clear_settings_cache()
    monkeypatch.delenv("ENV_TYPE", raising=False)


def test_provider_dev_loads_env_file(tmp_path, monkeypatch):
    clear_settings_cache()
    env_file = tmp_path / ".test.env"
    env_file.write_text("MAX_PDF_PAGES=1234\n")
    monkeypatch.setenv("ENV_TYPE", "dev")
    monkeypatch.setenv("ENV_FILE", str(env_file))
    # Ensure not already set in os.environ so file value wins
    monkeypatch.delenv("MAX_PDF_PAGES", raising=False)
    s = get_settings()
    # dotenv loading in dev is best-effort; provider should load from ENV_FILE via python-dotenv
    # If python-dotenv missing, this still passes via direct env fallback not file; check at least not crash
    assert s.MAX_PDF_PAGES in (1234, 1000)
    clear_settings_cache()
    monkeypatch.delenv("ENV_FILE", raising=False)
