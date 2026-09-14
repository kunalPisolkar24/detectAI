import argparse
import sys
from pathlib import Path

# Ensure src is importable when running as `python main.py` or `python -m main`
sys.path.insert(0, str(Path(__file__).parent))

from src.application.env_parser import parse_env_file  # noqa: E402
from src.application.seeder import Seeder  # noqa: E402
from src.core.exceptions import EnvParseError, GuardError, SecretsWriteError  # noqa: E402
from src.domain.schemas import SeedConfig  # noqa: E402
from src.infrastructure.secrets_manager import Boto3SecretsManager  # noqa: E402


def _parse_only(value: str | None) -> frozenset[str] | None:
    if not value:
        return None
    parts = [p.strip() for p in value.split(",") if p.strip()]
    return frozenset(parts) if parts else None


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Seed app-only secrets from a .env file into Floci or real AWS Secrets Manager.",
        epilog="Example: python main.py --env-file infra/docker/prod/.env --endpoint-url http://localhost:4566",
    )
    parser.add_argument(
        "--env-file",
        default="infra/docker/prod/.env",
        help="Path to .env file (default: infra/docker/prod/.env)",
    )
    parser.add_argument(
        "--endpoint-url",
        default=None,
        help="AWS endpoint URL. Empty/omit = real AWS. Floci example: http://localhost:4566",
    )
    parser.add_argument("--region", default="ap-south-1", help="AWS region (default: ap-south-1)")
    parser.add_argument("--dry-run", action="store_true", help="Preview without writing")
    parser.add_argument(
        "--only",
        default=None,
        help="Comma-separated secret names to limit (e.g. detectai/web/secrets,detectai/gateway/secrets)",
    )
    parser.add_argument("--force", action="store_true", help="Allow overwriting TF-managed secrets")
    parser.add_argument(
        "--confirm-prod",
        action="store_true",
        help="Required when writing to real AWS (empty endpoint) without --dry-run",
    )
    args = parser.parse_args()

    # Support env vars for endpoint/region too (same as apps)
    endpoint = args.endpoint_url
    # allow --endpoint-url "" to mean real AWS
    if endpoint == "":
        endpoint = None
    if endpoint is None and args.endpoint_url is None:
        # check env if not passed
        import os

        endpoint = os.getenv("AWS_ENDPOINT_URL") or None
        if endpoint == "":
            endpoint = None

    only = _parse_only(args.only)

    # Resolve env-file relative to repo root if needed
    # Try given path, then relative to cwd, then relative to repo root (parent of tools/)
    env_path = Path(args.env_file)
    if not env_path.is_absolute() and not env_path.exists():
        # try from repo root
        repo_root = Path(__file__).parent.parent.parent
        alt = repo_root / args.env_file
        if alt.exists():
            env_path = alt

    config = SeedConfig(
        env_file=str(env_path),
        endpoint_url=endpoint,
        region=args.region,
        dry_run=args.dry_run,
        only=only,
        force=args.force,
        confirm_prod=args.confirm_prod,
    )

    # Friendly banner (never prints values)
    target = "real AWS" if config.is_real_aws else f"Floci ({endpoint})"
    if config.dry_run:
        print(f"[dry-run] target={target} region={config.region} env-file={env_path}")
    else:
        print(f"target={target} region={config.region} env-file={env_path}")

    if config.is_real_aws and not config.confirm_prod and not config.dry_run:
        print("ERROR: writing to real AWS requires --confirm-prod (or --dry-run to preview)", file=sys.stderr)
        sys.exit(2)

    try:
        env = parse_env_file(str(env_path))
    except EnvParseError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(2)

    # Show which allowlisted keys were found (keys only, not values)
    from src.domain.constants import ALLOWLIST  # noqa: E402

    found = sorted(k for k in env if k in ALLOWLIST and env[k] != "")
    # Don't spam all missing; show found and count
    if found:
        print(f"found {len(found)} allowlisted keys in {env_path.name}: {', '.join(found)}")
    else:
        print(f"warning: no allowlisted keys found in {env_path} (found keys: {', '.join(sorted(env.keys())[:10])})")

    store = Boto3SecretsManager(region=config.region, endpoint_url=endpoint)
    seeder = Seeder(store)

    try:
        results, generated = seeder.seed(config, env)
    except GuardError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(2)
    except SecretsWriteError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)

    for name, status in results:
        # find payload key count for this secret
        payload_keys = next((len(p.data) for p in seeder.build_payloads(env, only=config.only) if p.name == name), "?")
        print(f"{status:8s} {name} ({payload_keys} keys)")

    if generated:
        print(f"\nGenerated {len(generated)} keys (not in .env, created once and synced):")
        for g in generated:
            print(f"  - {g}")
        print("\nHint: add generated values to your .env to keep them stable across runs.")
        print("  e.g. run with --dry-run first, copy values after real seed, or let the seeder generate and persist.")

    if config.dry_run:
        print("\n[dry-run] no secrets were written.")
    else:
        print(f"\nDone. Wrote {len(results)} secrets to {target}.")

    # Verify hint
    if not config.dry_run:
        print("\nVerify: aws --endpoint-url {} --region {} secretsmanager list-secrets --query 'SecretList[].Name'".format(
            endpoint or "https://secretsmanager.{}.amazonaws.com".format(config.region), config.region
        ))


if __name__ == "__main__":
    main()
