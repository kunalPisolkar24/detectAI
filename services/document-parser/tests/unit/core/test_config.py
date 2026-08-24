from app.core.config import Settings


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
