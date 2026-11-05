"""Terraform inputs: the TF_VAR map and the per-plane backend file."""

from __future__ import annotations

import json
import tempfile
from pathlib import Path

from app.declaration.model import Declaration, state_bucket_for
from app.values.plane import (
    resolve_floci_url,
    resolve_recovery_window,
    resolve_region,
)

# One shared terraform root for every service; the backend file and TF_VARs
# select the service's plane at run time.
PLANE_ROOT = Path(__file__).resolve().parents[2] / "terraform" / "plane"


def state_key(declaration: Declaration, is_emulator: bool) -> str:
    segment = "floci/" if is_emulator else ""
    return f"{declaration.slug}/{segment}terraform.tfstate"


def build_tf_vars(
    declaration: Declaration, values: dict[str, str], is_emulator: bool
) -> dict[str, str]:
    tf_vars = {
        "TF_VAR_aws_region": resolve_region(declaration, values),
        "TF_VAR_service_slug": declaration.slug,
        "TF_VAR_secret_recovery_window": str(
            resolve_recovery_window(declaration, values, is_emulator)
        ),
    }
    # Non-empty blob keys ride the secrets blob: the whole map is the contract.
    blob = {key: values[key] for key in declaration.blob_keys if values.get(key, "") != ""}
    if blob:
        tf_vars["TF_VAR_blob"] = json.dumps(blob)
    # Non-secret config rides the SSM map; absent or empty seeds nothing.
    config = {key: values[key] for key in declaration.ssm_keys if values.get(key, "") != ""}
    if config:
        tf_vars["TF_VAR_ssm_parameters"] = json.dumps(config)
    if is_emulator:
        tf_vars["TF_VAR_emulator_endpoint"] = resolve_floci_url()
    return tf_vars


def build_backend_hcl(
    declaration: Declaration, values: dict[str, str], is_emulator: bool, account: str
) -> str:
    region = resolve_region(declaration, values)
    bucket = state_bucket_for(declaration.slug, account)
    key = state_key(declaration, is_emulator)
    if is_emulator:
        lines = [
            f'bucket                      = "{bucket}"',
            f'key                         = "{key}"',
            f'region                      = "{region}"',
            "encrypt                     = false",
            "skip_credentials_validation = true",
            "skip_metadata_api_check     = true",
            "skip_requesting_account_id  = true",
            "skip_region_validation      = true",
            "use_path_style              = true",
            "endpoints = {",
            f'  s3 = "{resolve_floci_url()}"',
            "}",
        ]
    else:
        lines = [
            f'bucket                      = "{bucket}"',
            f'key                         = "{key}"',
            f'region                      = "{region}"',
            "encrypt                     = true",
            "use_lockfile                = true",
        ]
    return "\n".join(lines) + "\n"


def write_backend_hcl(backend_hcl: str) -> Path:
    with tempfile.NamedTemporaryFile(mode="w", suffix=".hcl", delete=False) as handle:
        handle.write(backend_hcl)
        return Path(handle.name)
