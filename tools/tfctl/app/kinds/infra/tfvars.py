"""TF_VAR composition: the region, both fabric ledgers, and plane specifics."""

from __future__ import annotations

import json

from app.engine.values.plane import resolve_floci_url, resolve_region
from app.kinds.infra.declaration import InfraDeclaration


def csv_items(raw: str) -> list[str]:
    """The values file carries list settings as comma-separated strings."""
    return [item.strip() for item in raw.split(",") if item.strip()]


def queue_ledger_map(declaration: InfraDeclaration) -> dict[str, dict]:
    """The declaration's ledger as the module's for_each map; names are the keys."""
    return {
        entry.name: {
            "name": entry.name,
            "dlq": entry.dlq,
            "max_receive_count": entry.max_receive_count,
        }
        for entry in declaration.queue_ledger
    }


def cache_ledger_map(declaration: InfraDeclaration) -> dict[str, dict]:
    """The cache ledger as the module's for_each map; names are the keys."""
    return {
        entry.name: {
            "name": entry.name,
            "engine": entry.engine,
            "engine_version": entry.engine_version,
            "node_type": entry.node_type,
            "num_cache_nodes": entry.num_cache_nodes,
            "port": entry.port,
            "parameter_group_name": entry.parameter_group_name,
        }
        for entry in declaration.cache_ledger
    }


def build_tf_vars(
    declaration: InfraDeclaration, values: dict[str, str], is_emulator: bool
) -> dict[str, str]:
    tf_vars = {
        "TF_VAR_aws_region": resolve_region(declaration, values),
        "TF_VAR_queues": json.dumps(queue_ledger_map(declaration)),
        "TF_VAR_cache_clusters": json.dumps(cache_ledger_map(declaration)),
    }
    if declaration.cache_ledger:
        tf_vars["TF_VAR_cache_auth_token"] = values.get("REDIS_AUTH_TOKEN", "")
        tf_vars["TF_VAR_cache_subnet_ids"] = json.dumps(
            csv_items(values.get("CACHE_SUBNET_IDS", ""))
        )
        tf_vars["TF_VAR_cache_security_group_ids"] = json.dumps(
            csv_items(values.get("CACHE_SECURITY_GROUP_IDS", ""))
        )
    if is_emulator:
        tf_vars["TF_VAR_emulator_endpoint"] = resolve_floci_url()
    return tf_vars
