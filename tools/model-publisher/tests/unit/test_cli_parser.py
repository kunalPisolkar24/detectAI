from __future__ import annotations

import pytest

from src.application.dto import PublishCommand
from src.cli.parser import build_parser, parse_args


def test_parse_minimal() -> None:
    cmd = parse_args(["--model", "detect-ai-spark", "--version", "v1.0.0"])
    assert cmd.model == "detect-ai-spark"
    assert cmd.version == "v1.0.0"
    assert cmd.dry_run is False
    assert cmd.assets_dir is None


def test_parse_all_flags(tmp_path) -> None:  # type: ignore[no-untyped-def]
    cmd = parse_args(
        [
            "--model",
            "detect-ai-flare",
            "--version",
            "v2.0.1",
            "--description",
            "hotfix",
            "--assets-dir",
            str(tmp_path),
            "--dry-run",
            "--verbose",
        ]
    )
    assert isinstance(cmd, PublishCommand)
    assert cmd.description == "hotfix"
    assert cmd.dry_run is True
    assert str(cmd.assets_dir) == str(tmp_path)


def test_parse_missing_required_exits() -> None:
    parser = build_parser()
    with pytest.raises(SystemExit):
        parser.parse_args(["--model", "x"])
