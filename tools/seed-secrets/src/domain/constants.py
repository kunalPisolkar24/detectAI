"""Single source of truth for secret names, keys and guard lists."""

# Terraform-managed secrets — never overwritten without --force
TF_MANAGED_SECRETS = frozenset(
    {
        "detectai/pg/urls",
        "detectai/pg/master",
        "detectai/docdb/urls",
        "detectai/redis/chat/urls",
        "detectai/redis/events/urls",
        "detectai/redis/users/urls",
        "detectai/mq/urls",
    }
)

# App-only secrets (the ones this tool manages)
WEB_SECRET = "detectai/web/secrets"
GATEWAY_SECRET = "detectai/gateway/secrets"
WORKERS_SECRET = "detectai/workers/secrets"
INFERENCE_SECRET = "detectai/inference/secrets"
DOC_PARSER_SECRET = "detectai/document-parser/secrets"

APP_SECRETS = frozenset({WEB_SECRET, GATEWAY_SECRET, WORKERS_SECRET, INFERENCE_SECRET, DOC_PARSER_SECRET})

# Mapping: secret name -> env keys that belong to it
# Order matters only for readability; seeder builds dicts from these.
SECRET_KEY_MAP: dict[str, list[str]] = {
    WEB_SECRET: [
        "NEXTAUTH_SECRET",
        "INTERNAL_API_KEY",
        "AI_SERVICE_API_KEY",
        "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
        "TURNSTILE_SECRET_KEY",
        "NEXT_PUBLIC_PADDLE_CLIENT_TOKEN",
        "GOOGLE_ID",
        "GOOGLE_SECRET",
        "GITHUB_ID",
        "GITHUB_SECRET",
        "PROMETHEUS_WEB_SCRAPE_TOKEN",
    ],
    GATEWAY_SECRET: [
        "PADDLE_WEBHOOK_SECRET",
        "INTERNAL_API_KEY",
    ],
    WORKERS_SECRET: [
        "PADDLE_API_KEY",
        "PADDLE_ENVIRONMENT",
    ],
    INFERENCE_SECRET: [
        "API_KEY",
        "HF_TOKEN",
    ],
    DOC_PARSER_SECRET: [
        # intentionally empty; populated only if caller explicitly sets keys
    ],
}

# Allowlist = union of all keys we ever read from .env
# Everything else in .env (DATABASE_URL, REDIS_URL, etc.) is ignored.
ALLOWLIST: frozenset[str] = frozenset(
    {k for keys in SECRET_KEY_MAP.values() for k in keys}
    | {
        # aliases / fallbacks
        "HF_TOKEN",  # also in inference
        "PADDLE_ENVIRONMENT",
        # inference API_KEY fallback source
        "AI_SERVICE_API_KEY",
    }
)

# Keys that are "shared" — one value generated once and synced across secrets.
SHARED_KEYS = frozenset({"INTERNAL_API_KEY", "AI_SERVICE_API_KEY", "API_KEY"})
# Mapping of fallback: if API_KEY missing, use AI_SERVICE_API_KEY
API_KEY_FALLBACK = "AI_SERVICE_API_KEY"

# Default for PADDLE_ENVIRONMENT if not provided
DEFAULT_PADDLE_ENV = "sandbox"
