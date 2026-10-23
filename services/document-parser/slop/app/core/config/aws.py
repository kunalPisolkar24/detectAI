"""AWS config loader for ``ENV_TYPE=prod``.

Pulls secrets from Secrets Manager and non-secret tunables from SSM Parameter
Store, mirroring ``services/inference/src/infrastructure/config/aws.py``,
``services/workers/src/shared/config/aws.ts`` and
``services/payments/gateway/internal/config/aws.go``.

Order of precedence (highest wins):
1. ``process env`` / ``cfg`` already set (env wins over AWS)
2. Secrets Manager JSON (``detectai/document-parser/secrets``)
3. SSM ``/detectai/document-parser/*``

The document parser is stateless — the secret may not exist yet in early
environments. Missing secret in prod is therefore *tolerant* (warning only),
unlike inference which raises.
"""

from __future__ import annotations

import json
import os

try:
    import structlog  # type: ignore

    _structlog_available = True
except ImportError:
    _structlog_available = False
    structlog = None  # type: ignore

import logging

_logger = logging.getLogger(__name__)

_DOCUMENT_PARSER_SECRETS_DEFAULT = "detectai/document-parser/secrets"
_SSM_PREFIX_DEFAULT = "/detectai/document-parser/"
_AWS_REGION_DEFAULT = "ap-south-1"


def _log_info(event: str, **kwargs: object) -> None:
    if _structlog_available:
        try:
            structlog.get_logger().info(event, **kwargs)  # type: ignore
            return
        except Exception:
            pass
    _logger.info("%s %s", event, kwargs)


def _log_warning(event: str, **kwargs: object) -> None:
    if _structlog_available:
        try:
            structlog.get_logger().warning(event, **kwargs)  # type: ignore
            return
        except Exception:
            pass
    _logger.warning("%s %s", event, kwargs)


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
    endpoint = os.getenv("AWS_ENDPOINT_URL") or None
    kwargs: dict = {"region_name": region}
    if endpoint:
        kwargs["endpoint_url"] = endpoint
    if endpoint and _is_floci_endpoint(endpoint) and not os.getenv("AWS_ACCESS_KEY_ID"):
        kwargs["aws_access_key_id"] = "test"
        kwargs["aws_secret_access_key"] = "test"
    return kwargs


def _load_secrets_manager(cfg: dict[str, str]) -> None:
    """Load optional secrets from Secrets Manager.

    Document-parser currently has no mandatory secrets — the secret is
    optional and missing values are tolerated even in prod. If the secret
    exists as JSON, any keys it contains are merged into ``cfg`` (env still
    wins). Raw string secrets are ignored (no canonical secret for this
    service yet).
    """
    try:
        import boto3  # type: ignore
        from botocore.exceptions import ClientError  # type: ignore
    except ImportError as e:
        _log_warning("aws_secrets_skipped_missing_boto3", error=str(e))
        return

    secret_name = _env_or(
        "DOCUMENT_PARSER_SECRETS_NAME",
        _env_or("DOCUMENT_PARSER_SECRETS_ARN", _DOCUMENT_PARSER_SECRETS_DEFAULT),
    )
    # Legacy alias (inference uses INFERENCE_SECRETS_NAME)
    if not os.getenv("DOCUMENT_PARSER_SECRETS_NAME") and os.getenv("INFERENCE_SECRETS_NAME"):
        secret_name = os.getenv("INFERENCE_SECRETS_NAME", secret_name)
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
        if not raw:
            return
        try:
            data = json.loads(raw)
            if not isinstance(data, dict):
                raise ValueError("secret JSON is not an object")
            norm = {str(k).upper(): str(v) for k, v in data.items() if v is not None}
            for k, v in norm.items():
                if k and v and not cfg.get(k):
                    # Only merge if caller hasn't set via env/AWS already; respect precedence
                    cfg[k] = v
        except (json.JSONDecodeError, ValueError):
            # Raw string secret — no canonical key for document-parser; log and ignore
            _log_info("aws_secret_raw_string_ignored", secret=secret_name)
            return
    except Exception as err:  # noqa: BLE001
        try:
            from botocore.exceptions import ClientError

            if isinstance(err, ClientError):
                code = err.response.get("Error", {}).get("Code", "")
                if code == "ResourceNotFoundException":
                    # Tolerant even in prod — document-parser has no required secret
                    _log_warning("aws_secret_not_found", secret=secret_name, env_type=_env_or("ENV_TYPE", "dev"))
                    return
        except ImportError:
            pass
        if _is_missing_secret(err):
            _log_warning("aws_secret_not_found", secret=secret_name, env_type=_env_or("ENV_TYPE", "dev"))
            return
        # For any other AWS error, surface as RuntimeError for visibility but don't crash prod
        # on optional secret — log and continue.
        _log_warning("aws_secret_load_failed", secret=secret_name, error=str(err))
        return


def _load_ssm_parameters(cfg: dict[str, str]) -> None:
    """Load non-secret tunables from SSM Parameter Store."""
    prefix = _env_or("SSM_PREFIX", _env_or("SSM_PARAM_PREFIX", ""))
    if not prefix:
        prefix = _SSM_PREFIX_DEFAULT
        if os.getenv("SSM_ENABLED") in {"0", "false", "False"}:
            _log_info("ssm_disabled_via_env")
            return
    if not prefix.endswith("/"):
        prefix += "/"

    try:
        import boto3  # type: ignore
    except ImportError as e:
        _log_warning("aws_ssm_skipped_missing_boto3", error=str(e))
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
                if os.getenv(key) not in (None, ""):
                    continue
                if cfg.get(key) not in (None, ""):
                    continue
                cfg[key] = str(value)
        if not found:
            _log_info("ssm_no_parameters_found", prefix=prefix)
    except Exception as err:  # noqa: BLE001
        if _is_missing_param(err):
            _log_info("ssm_prefix_not_found", prefix=prefix)
            return
        raise RuntimeError(f"ssm get parameters by path {prefix}: {err}") from err


def load_from_aws(cfg: dict[str, str]) -> None:
    """Load Secrets Manager + SSM into ``cfg`` in place."""
    _load_secrets_manager(cfg)
    _load_ssm_parameters(cfg)
