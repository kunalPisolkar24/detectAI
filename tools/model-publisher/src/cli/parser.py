"""CLI parser — testable without subprocess."""

from __future__ import annotations

import argparse
from pathlib import Path

from src.application.dto import PublishCommand


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Publish DetectAI model artifacts to HuggingFace Hub.",
        epilog="Example: python main.py --model detect-ai-spark --version v1.0.0 --dry-run",
    )
    p.add_argument("--model", required=True, help="Model name (e.g., detect-ai-spark)")
    p.add_argument("--version", required=True, help="Version tag (e.g., v1.0.0)")
    p.add_argument(
        "--description",
        default=None,
        help="Release description (default: 'Production release <version>')",
    )
    p.add_argument(
        "--assets-dir",
        default=None,
        help="Override assets base directory (e.g. /tmp/assets or ./assets)",
    )
    p.add_argument("--dry-run", action="store_true", help="Validate only, do not upload or tag")
    p.add_argument("--verbose", action="store_true", help="Verbose logging")
    return p


def parse_args(argv: list[str] | None = None) -> PublishCommand:
    parser = build_parser()
    args = parser.parse_args(argv)
    assets_dir: Path | None = Path(args.assets_dir) if args.assets_dir else None
    return PublishCommand(
        model=args.model,
        version=args.version,
        description=args.description,
        assets_dir=assets_dir,
        dry_run=bool(args.dry_run),
    )


def parse_verbose_flag(argv: list[str] | None = None) -> bool:
    # helper for main bootstrap before full parse
    return "--verbose" in (argv or [])
