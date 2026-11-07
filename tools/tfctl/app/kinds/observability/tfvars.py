"""TF_VAR composition: the New Relic credential trio for the provider block."""

from __future__ import annotations

from app.kinds.observability.declaration import ObservabilityDeclaration
from app.kinds.observability.values import build_config


def build_tf_vars(
    declaration: ObservabilityDeclaration, values: dict[str, str], is_emulator: bool
) -> dict[str, str]:
    config = build_config(values)
    tf_vars = {"TF_VAR_newrelic_api_key": config["api_key"]}
    if config["account_id"]:
        tf_vars["TF_VAR_newrelic_account_id"] = config["account_id"]
    if config["region"]:
        tf_vars["TF_VAR_newrelic_region"] = config["region"]
    return tf_vars
