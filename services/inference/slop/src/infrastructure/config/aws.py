"""AWS config loader for ``ENV_TYPE=prod``.

Pulls secrets from Secrets Manager and non-secret tunables from SSM Parameter
Store, mirroring ``services/payments/gateway/internal/config/aws.go`` and
``services/workers/src/shared/config/aws.ts``.

Order of precedence (highest wins):
1. ``process env`` / ``cfg`` already set (env wins over AWS)
2. Secrets Manager JSON (``detectai/inference/secrets``)
3. SSM ``/detectai/inference/*``
"""

from __future__ import annotations

import json
import os

import structlog

logger = structlog.get_logger()

_INFERENCE_SECRETS_DEFAULT = "detectai/inference/secrets"
_SSM_PREFIX_DEFAULT = "/detectai/inference/"
_AWS_REGION_DEFAULT = "ap-south-1"


def _env_or(key: str, fallback: str) -> str:
    v = os.getenv(key)
    return v if v is not None and v != "" else fallback


def _is_floci_endpoint(ep: str) -> bool:
    return "localhost:4566" in ep or "127.0.0.1:4566" in ep or "host.docker.internal:4566" in ep


def _is_missing_secret(err: Exception) -> bool:
    msg = str(err)
    return "ResourceNotFoundException" in msg or "not found" in msg.lower()


def _is_missing_param(err: Exception) -> bool:
    msg = str(err)
    return "ParameterNotFound" in msg or "not found" in msg.lower()


def _get_aws_common_kwargs() -> dict:
    """Build boto3 common kwargs (region + optional endpoint + Floci creds)."""
    region = _env_or("AWS_REGION", _AWS_REGION_DEFAULT)
    # cfg may have AWS_REGION string override; provider merges cfg before calling,
    # but we also read directly from env for parity with gateway.
    endpoint = os.getenv("AWS_ENDPOINT_URL") or None
    kwargs: dict = {"region_name": region}
    if endpoint:
        kwargs["endpoint_url"] = endpoint
    # Floci needs dummy creds when no real AWS creds are present
    if endpoint and _is_floci_endpoint(endpoint) and not os.getenv("AWS_ACCESS_KEY_ID"):
        kwargs["aws_access_key_id"] = "test"
        kwargs["aws_secret_access_key"] = "test"
    return kwargs


def _load_secrets_manager(cfg: dict[str, str]) -> None:
    """Load ``API_KEY`` and ``HF_TOKEN`` from Secrets Manager."""
    try:
        import boto3
        from botocore.exceptions import ClientError  # type: ignore
    except ImportError as e:
        logger.warning("aws_secrets_skipped_missing_boto3", error=str(e))
        return

    secret_name = _env_or(
        "INFERENCE_SECRETS_NAME",
        _env_or("INFERENCE_SECRETS_ARN", _INFERENCE_SECRETS_DEFAULT),
    )
    if not secret_name:
        return

    common = _get_aws_common_kwargs()
    client = boto3.client("secretsmanager", **common)

    try:
        out = client.get_secret_value(SecretId=secret_name)
        secret_str = out.get("SecretString")
        if not secret_str:
            return
        raw = secret_str.strip()
        # Try JSON object first (expected), fallback to raw string as API_KEY
        try:
            data = json.loads(raw)
            if not isinstance(data, dict):
                raise ValueError("secret JSON is not an object")
            # Normalize keys to upper for case-insensitive match
            norm = {str(k).upper(): str(v) for k, v in data.items() if v is not None}
            # Canonical mappings
            if "API_KEY" in norm and not cfg.get("API_KEY"):
                cfg["API_KEY"] = norm["API_KEY"]
            if "HF_TOKEN" in norm and not cfg.get("HF_TOKEN"):
                cfg["HF_TOKEN"] = norm["HF_TOKEN"]
            # Also accept lowercase variants / generic upper keys for forward compat
            for k, v in norm.items():
                if k in {"API_KEY", "HF_TOKEN"}:
                    continue
                if k and v and not cfg.get(k):
                    cfg[k] = v
        except (json.JSONDecodeError, ValueError):
            # Raw string secret -> treat as API_KEY if it looks non-empty
            if raw and not cfg.get("API_KEY"):
                cfg["API_KEY"] = raw
    except Exception as err:  # noqa: BLE001
        # boto3 wraps missing as ClientError with Code=ResourceNotFoundException
        try:
            from botocore.exceptions import ClientError

            if isinstance(err, ClientError):
                code = err.response.get("Error", {}).get("Code", "")
                if code == "ResourceNotFoundException":
                    if _env_or("ENV_TYPE", "dev") == "prod":
                        raise RuntimeError(f"get secret {secret_name}: {err}") from err
                    logger.warning("aws_secret_not_found_dev", secret=secret_name)
                    return
        except ImportError:
            pass
        if _is_missing_secret(err):
            if _env_or("ENV_TYPE", "dev") == "prod":
                raise RuntimeError(f"get secret {secret_name}: {err}") from err
            logger.warning("aws_secret_not_found_dev", secret=secret_name)
            return
        raise RuntimeError(f"get secret {secret_name}: {err}") from err


def _load_ssm_parameters(cfg: dict[str, str]) -> None:
    """Load non-secret tunables from SSM Parameter Store."""
    prefix = _env_or("SSM_PREFIX", _env_or("SSM_PARAM_PREFIX", ""))
    if not prefix:
        prefix = _SSM_PREFIX_DEFAULT
        # Opt-out when explicitly disabled (matches gateway/workers)
        if os.getenv("SSM_ENABLED") in {"0", "false", "False"}:
            logger.info("ssm_disabled_via_env")
            return
    if not prefix.endswith("/"):
        prefix += "/"

    try:
        import boto3
    except ImportError as e:
        logger.warning("aws_ssm_skipped_missing_boto3", error=str(e))
        return

    common = _get_aws_common_kwargs()
    client = boto3.client("ssm", **common)

    paginator = client.get_paginator("get_parameters_by_path")
    try:
        found = False
        for page in paginator.paginate(Path=prefix, Recursive=True, WithDecryption=True):
            for param in page.get("Parameters", []) or []:
                name = param.get("Name")
                value = param.get("Value")
                if not name or value is None:
                    continue
                found = True
                key = name[len(prefix) :].upper().replace("-", "_")
                if not key:
                    continue
                # Env and already-set cfg win over SSM (env > AWS)
                if os.getenv(key) not in (None, ""):
                    continue
                if cfg.get(key) not in (None, ""):
                    continue
                # Allow any key, but non-secret allow-list is implicit via Settings(extra=ignore)
                # Store as string for pydantic coercion
                cfg[key] = str(value)
        if not found:
            logger.info("ssm_no_parameters_found", prefix=prefix)
    except Exception as err:  # noqa: BLE001
        if _is_missing_param(err):
            logger.info("ssm_prefix_not_found", prefix=prefix)
            return
        raise RuntimeError(f"ssm get parameters by path {prefix}: {err}") from err


def load_from_aws(cfg: dict[str, str]) -> None:
    """Load Secrets Manager + SSM into ``cfg`` in place."""
    _load_secrets_manager(cfg)
    _load_ssm_parameters(cfg)
