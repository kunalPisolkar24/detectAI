"""The secrets flavor's TF_VAR map: blob, SSM params, window, region, emulator."""

from __future__ import annotations

import json

from app.engine.values.plane import resolve_floci_url, resolve_region
from app.kinds.secrets.declaration import SecretsDeclaration
from app.kinds.secrets.values import resolve_recovery_window


def build_tf_vars(
    declaration: SecretsDeclaration, values: dict[str, str], is_emulator: bool
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
