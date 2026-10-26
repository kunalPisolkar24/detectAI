"""Settings through a config plane: provider values win over the process
environment, a missing or invalid required key fails the boot on the field's
own contract, undeclared plane keys are ignored, and the flick stays
fail-closed.
"""

from pathlib import Path

import pytest
from pydantic import ValidationError

from app.config import ConfigProvider, Settings, deployment_flick
from app.config.adapters import dotenv as dotenv_module
from app.config.adapters.dotenv import DotEnvAdapter
from app.config.provider import DevConfig
from app.extraction import (
    DEFAULT_EDGE_TOLERANCE_RATIO,
    DEFAULT_EDGE_ZONE_RATIO,
    DEFAULT_FOLIO_MONOTONIC_RATIO,
    DEFAULT_HEADER_EDGE_ZONE_RATIO,
    DEFAULT_HEADER_REPETITION_RATIO,
    DEFAULT_REPETITION_MIN_PAGES,
)
from app.validation.models import (
    DEFAULT_DOCX_MAX_UNCOMPRESSED_BYTES,
    DEFAULT_MAX_PDF_PAGES,
    DEFAULT_UPLOAD_LIMIT_BYTES,
)


class StubProvider(ConfigProvider):
    """Stands in for a plane in the composed chain: a plain dict lookup."""

    def __init__(self, values: dict[str, str]) -> None:
        self._values = values

    def get(self, key: str, default: str | None = None) -> str | None:
        return self._values.get(key, default)


def test_provider_values_win_over_a_poisoned_process_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("API_KEY", "a" * 20)

    settings = Settings.from_provider(StubProvider({"API_KEY": "b" * 20}))

    assert settings.api_key == "b" * 20


def test_a_dev_plane_off_the_process_env_fills_the_required_key(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # The fileless container shape: the dotenv default is absent, composition
    # injected the values as env vars, and they flow provider -> Settings.
    monkeypatch.delenv(dotenv_module.DOTENV_PATH_VAR, raising=False)
    monkeypatch.setattr(dotenv_module, "_DEFAULT_DOTENV_PATH", tmp_path / "absent" / ".env")
    monkeypatch.setenv("API_KEY", "a" * 20)

    settings = Settings.from_provider(DevConfig(DotEnvAdapter()))

    assert settings.api_key == "a" * 20


def test_an_unseeded_required_key_fails_the_boot() -> None:
    with pytest.raises(ValidationError):
        Settings.from_provider(StubProvider({}))


def test_a_short_required_key_fails_the_boot() -> None:
    with pytest.raises(ValidationError):
        Settings.from_provider(StubProvider({"API_KEY": "short"}))


_BOUNDS: tuple[tuple[str, int], ...] = (
    ("upload_limit_bytes", DEFAULT_UPLOAD_LIMIT_BYTES),
    ("max_pdf_pages", DEFAULT_MAX_PDF_PAGES),
    ("docx_max_uncompressed_bytes", DEFAULT_DOCX_MAX_UNCOMPRESSED_BYTES),
)


def test_the_bounds_land_on_their_safe_defaults_without_seeds() -> None:
    settings = Settings.from_provider(StubProvider({"API_KEY": "a" * 20}))

    for field, default in _BOUNDS:
        assert getattr(settings, field) == default


def test_the_bounds_read_plain_numeric_seeds_from_the_string_plane() -> None:
    settings = Settings.from_provider(
        StubProvider({"API_KEY": "a" * 20, **{name.upper(): str(default * 2) for name, default in _BOUNDS}})
    )

    for field, default in _BOUNDS:
        assert getattr(settings, field) == default * 2


@pytest.mark.parametrize("seeded", ["not a number", "-1", "0", "1.5", " "])
def test_an_invalid_bound_falls_back_to_its_safe_default(seeded: str) -> None:
    for field, default in _BOUNDS:
        settings = Settings.from_provider(StubProvider({"API_KEY": "a" * 20, field.upper(): seeded}))

        assert getattr(settings, field) == default


def test_the_moved_bounds_pin_their_spec_values() -> None:
    # Wire contract (the 413 detail names the bound): the two Lambda-era
    # defaults are pinned exact, which the constant-keyed test cannot do.
    assert DEFAULT_UPLOAD_LIMIT_BYTES == 3_145_728
    assert DEFAULT_DOCX_MAX_UNCOMPRESSED_BYTES == 31_457_280


# cleaning.md knobs: strict on purpose — no fallback, the boot dies.
_RATIO_FIELDS = ("header_repetition_ratio", "edge_tolerance_ratio", "folio_monotonic_ratio")
_ZONE_FIELDS = ("header_edge_zone_ratio", "edge_zone_ratio")
_KNOB_DEFAULTS: tuple[tuple[str, float], ...] = (
    ("header_repetition_ratio", DEFAULT_HEADER_REPETITION_RATIO),
    ("repetition_min_pages", DEFAULT_REPETITION_MIN_PAGES),
    ("header_edge_zone_ratio", DEFAULT_HEADER_EDGE_ZONE_RATIO),
    ("edge_zone_ratio", DEFAULT_EDGE_ZONE_RATIO),
    ("edge_tolerance_ratio", DEFAULT_EDGE_TOLERANCE_RATIO),
    ("folio_monotonic_ratio", DEFAULT_FOLIO_MONOTONIC_RATIO),
)


def test_the_cleaning_knobs_hold_their_spec_defaults() -> None:
    settings = Settings.from_provider(StubProvider({"API_KEY": "a" * 20}))

    for field, default in _KNOB_DEFAULTS:
        assert getattr(settings, field) == default


def test_the_cleaning_knobs_coerce_the_string_plane() -> None:
    seeds = {"API_KEY": "a" * 20, "REPETITION_MIN_PAGES": "6"}
    seeds.update({field.upper(): "0.45" for field in (*_RATIO_FIELDS, *_ZONE_FIELDS)})

    settings = Settings.from_provider(StubProvider(seeds))

    assert settings.repetition_min_pages == 6
    for field in (*_RATIO_FIELDS, *_ZONE_FIELDS):
        assert getattr(settings, field) == 0.45


@pytest.mark.parametrize(
    ("field", "seeded"),
    [
        ("header_repetition_ratio", "1.0"),  # unit interval is exclusive
        ("header_repetition_ratio", "not a ratio"),
        ("folio_monotonic_ratio", "0"),  # exclusive at the low end too
        ("edge_zone_ratio", "0.5"),  # zones cap out below half the page
        ("edge_zone_ratio", "-0.1"),
        ("edge_tolerance_ratio", "two percent"),
        ("repetition_min_pages", "1"),
        ("repetition_min_pages", "4.5"),
    ],
)
def test_an_invalid_cleaning_knob_fails_the_boot(field: str, seeded: str) -> None:
    with pytest.raises(ValidationError):
        Settings.from_provider(StubProvider({"API_KEY": "a" * 20, field.upper(): seeded}))


def test_undeclared_plane_keys_ride_and_drop() -> None:
    settings = Settings.from_provider(
        StubProvider({
            "API_KEY": "a" * 20,
            "WORKER_THREADS": "4",
            "ENV_TYPE": "prod",  # the flick stays off the model
        })
    )

    assert settings.api_key == "a" * 20
    assert not hasattr(settings, "env_type")
    assert not hasattr(settings, "worker_threads")


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("prod", "prod"),
        ("PROD", "prod"),
        (" prod ", "prod"),
        ("dev", "dev"),
        ("production", "dev"),
        ("", "dev"),
    ],
)
def test_deployment_flick_is_fail_closed(
    monkeypatch: pytest.MonkeyPatch, raw: str, expected: str
) -> None:
    monkeypatch.setenv("ENV_TYPE", raw)
    assert deployment_flick() == expected
