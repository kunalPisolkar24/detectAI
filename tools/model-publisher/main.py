"""Thin bootstrap — parse args, wire container, run use-case."""

from __future__ import annotations

import sys
from pathlib import Path

# Make `src` importable when running `python main.py` vs `poetry run`
sys.path.insert(0, str(Path(__file__).parent))

from src.cli.parser import build_parser  # noqa: E402
from src.core.constants import EXIT_CODE_RUNTIME, EXIT_CODE_USAGE  # noqa: E402
from src.core.exceptions import ArtifactNotFoundException, ConfigError, MLException  # noqa: E402
from src.core.logging import configure_logging, redact  # noqa: E402
from src.infrastructure.composition.container import build_publisher  # noqa: E402
from src.infrastructure.config.provider import get_settings  # noqa: E402


def main(argv: list[str] | None = None) -> None:
    parser = build_parser()
    args = parser.parse_args(argv)

    configure_logging(verbose=bool(args.verbose))

    # Friendly banner (never prints token value)
    target = f"{args.model} @ {args.version}"
    mode = "dry-run " if args.dry_run else ""
    print(f"{mode}Publishing {target} ...")
    if args.assets_dir:
        print(f"  assets-dir: {args.assets_dir}")
    if args.description:
        print(f"  description: {args.description}")

    try:
        settings = get_settings()
    except Exception as e:
        print(f"Configuration error: {e}", file=sys.stderr)
        # hint without leaking values
        print("Hint: check .env / HF_TOKEN / HF_USERNAME", file=sys.stderr)
        sys.exit(EXIT_CODE_USAGE)

    # Redacted banner
    print(f"  hf_user: {settings.hf_username}  token: {redact(settings.hf_token)}")
    if args.dry_run:
        print("  mode: DRY-RUN (no upload/tag)")

    try:
        publisher = build_publisher(
            settings,
            assets_dir_override=args.assets_dir,
        )
        from src.application.dto import PublishCommand  # noqa: E402

        cmd = PublishCommand(
            model=args.model,
            version=args.version,
            description=args.description,
            assets_dir=args.assets_dir,
            dry_run=args.dry_run,
        )
        result = publisher.execute(cmd)
        if result.dry_run:
            print(f"Dry-run validated: {result.local_path} -> {result.repo_id} ({result.version})")
        else:
            print(f"Uploaded to {result.repo_id} -> {result.url}")
            print(f"Tagged {result.version}")
        print("Publication completed successfully." if not result.dry_run else "Dry-run completed successfully.")
    except ArtifactNotFoundException as e:
        print(f"Artifacts not found: {e}", file=sys.stderr)
        if e.path:
            print(f"  path: {e.path}", file=sys.stderr)
        sys.exit(EXIT_CODE_RUNTIME)
    except (ConfigError, MLException) as e:
        # MLException includes TagFailed/UploadFailed etc.
        print(f"Operation failed: {e}", file=sys.stderr)
        sys.exit(EXIT_CODE_RUNTIME)
    except Exception as e:
        # Pydantic validation / version/model_key errors -> usage error
        is_validation = e.__class__.__name__ == "ValidationError" or "validation error" in str(type(e)).lower()
        if is_validation or isinstance(e, ValueError):
            # distinguish guard vs runtime by checking message for version/model_key
            msg = str(e).lower()
            if "version" in msg or "model_key" in msg or "model" in msg:
                print(f"Invalid input: {e}", file=sys.stderr)
                sys.exit(EXIT_CODE_USAGE)
        print(f"Unexpected error: {e}", file=sys.stderr)
        sys.exit(EXIT_CODE_RUNTIME)
    finally:
        # keep cache warm for process; tests call clear_settings_cache explicitly
        pass


if __name__ == "__main__":
    main()
