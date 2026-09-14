import secrets
from src.core.exceptions import GuardError
from src.domain.constants import (
    API_KEY_FALLBACK,
    APP_SECRETS,
    DEFAULT_PADDLE_ENV,
    SECRET_KEY_MAP,
    TF_MANAGED_SECRETS,
)
from src.domain.schemas import SecretPayload, SeedConfig
from src.interfaces.secrets_store import ISecretsStore


def _generate_hex(nbytes: int) -> str:
    return secrets.token_hex(nbytes)


class Seeder:
    def __init__(self, store: ISecretsStore):
        self.store = store

    def build_payloads(self, env: dict[str, str], only: frozenset[str] | None = None) -> list[SecretPayload]:
        """Build per-secret payloads from parsed env dict.

        - Only keys in allowlist are considered.
        - Empty values are skipped.
        - Shared keys (INTERNAL_API_KEY, AI_SERVICE_API_KEY/API_KEY) are generated once if missing.
        - API_KEY falls back to AI_SERVICE_API_KEY.
        """
        # Normalize: copy only non-empty values
        present: dict[str, str] = {k: v for k, v in env.items() if v != ""}

        # Handle shared-key sync & generation
        internal = present.get("INTERNAL_API_KEY", "")
        if not internal:
            internal = _generate_hex(24)
            present["INTERNAL_API_KEY"] = internal

        # AI_SERVICE_API_KEY / API_KEY sync
        ai_key = present.get("AI_SERVICE_API_KEY", "") or present.get(API_KEY_FALLBACK, "")
        if not ai_key:
            ai_key = present.get("API_KEY", "")
        if not ai_key:
            ai_key = _generate_hex(24)
            present["AI_SERVICE_API_KEY"] = ai_key
            present["API_KEY"] = ai_key
        else:
            present.setdefault("AI_SERVICE_API_KEY", ai_key)
            present.setdefault("API_KEY", ai_key)

        # NEXTAUTH_SECRET
        if not present.get("NEXTAUTH_SECRET"):
            present["NEXTAUTH_SECRET"] = _generate_hex(32)

        # PADDLE_ENVIRONMENT default
        if "PADDLE_API_KEY" in present and not present.get("PADDLE_ENVIRONMENT"):
            present["PADDLE_ENVIRONMENT"] = DEFAULT_PADDLE_ENV

        payloads: list[SecretPayload] = []
        for secret_name, keys in SECRET_KEY_MAP.items():
            if only and secret_name not in only:
                continue
            data: dict[str, str] = {}
            for k in keys:
                # special: inference API_KEY already synced via present["API_KEY"]
                v = present.get(k, "")
                if v != "":
                    data[k] = v
            # Only emit non-empty payloads (except we want to emit even if only generated shared keys?)
            # If after filtering data is empty, skip the secret entirely.
            if not data:
                continue
            payloads.append(SecretPayload(name=secret_name, data=data))

        # attach generation hints for caller to log (without printing values here)
        # caller can check present for generated flags via comparing to original env
        # we return payloads; the hints are returned via side dict
        return payloads

    def seed(
        self, config: SeedConfig, env: dict[str, str]
    ) -> tuple[list[tuple[str, str]], list[str]]:
        """Execute seeding. Returns (results, generated_keys).

        results: list of (secret_name, status)
        generated_keys: list of keys that were auto-generated (names only)
        """
        # Guard: refuse to overwrite TF-managed without --force
        if config.only:
            for name in config.only:
                if name in TF_MANAGED_SECRETS and not config.force:
                    raise GuardError(f"refusing to touch TF-managed secret {name} without --force")
                if name not in APP_SECRETS and name not in TF_MANAGED_SECRETS:
                    raise GuardError(f"unknown secret {name}")

        # Guard: real AWS needs explicit confirmation
        if config.is_real_aws and not config.confirm_prod and not config.dry_run:
            raise GuardError(
                "refusing to write to real AWS without --confirm-prod (or use --dry-run to preview)"
            )

        original_keys = set(k for k, v in env.items() if v != "")
        payloads = self.build_payloads(env, only=config.only)

        # Track what was generated (keys not in original)
        generated = []
        if "INTERNAL_API_KEY" not in original_keys:
            generated.append("INTERNAL_API_KEY (synced to web + gateway)")
        if "AI_SERVICE_API_KEY" not in original_keys and "API_KEY" not in original_keys:
            generated.append("AI_SERVICE_API_KEY/API_KEY (synced to web + inference)")
        if "NEXTAUTH_SECRET" not in original_keys:
            generated.append("NEXTAUTH_SECRET")

        results: list[tuple[str, str]] = []
        for p in payloads:
            # Additional guard per payload
            if p.name in TF_MANAGED_SECRETS and not config.force:
                raise GuardError(f"refusing to touch TF-managed secret {p.name} without --force")
            if config.dry_run:
                results.append((p.name, "dry-run"))
                continue
            status = self.store.upsert(p, dry_run=False)
            results.append((p.name, status))
        return results, generated
