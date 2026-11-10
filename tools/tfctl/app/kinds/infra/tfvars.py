"""TF_VAR composition: the region, the queue ledger, and the emulator endpoint."""

from __future__ import annotations

import json

from app.engine.values.plane import resolve_floci_url, resolve_region
from app.kinds.infra.declaration import InfraDeclaration


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


def build_tf_vars(
    declaration: InfraDeclaration, values: dict[str, str], is_emulator: bool
) -> dict[str, str]:
    tf_vars = {
        "TF_VAR_aws_region": resolve_region(declaration, values),
        "TF_VAR_queues": json.dumps(queue_ledger_map(declaration)),
    }
    if is_emulator:
        tf_vars["TF_VAR_emulator_endpoint"] = resolve_floci_url()
    return tf_vars
