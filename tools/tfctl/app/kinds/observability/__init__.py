"""The observability kind: New Relic as code, driven by tfctl."""

from __future__ import annotations

from app.kinds import Kind

VERBS = ("check", "plan", "apply", "seeder-drop")


def kind() -> Kind:
    """The observability Kind slot, built here so main.py composes it explicitly."""
    from app.kinds.observability.declaration import load
    from app.kinds.observability.flow import stack_verb_flow, verb_flow
    from app.kinds.observability.policy import seeder_policy_document
    from app.kinds.observability.tfvars import build_tf_vars
    from app.kinds.observability.values import resolve_plane, validate

    return Kind(
        name="observability",
        declaration_filename="observability.toml",
        values_relpath="envs/.env",
        # The terraform root is the declaration's own directory, not vendored.
        stack_root=None,
        values_hint="run `make env` in observability, then fill NEW_RELIC_API_KEY",
        load=load,
        build_tf_vars=build_tf_vars,
        seeder_policy=seeder_policy_document,
        validate=validate,
        resolve_plane=resolve_plane,
        my_verbs=VERBS,
        service_scoped=False,
        terraform_flow=stack_verb_flow,
        verb_flow=verb_flow,
        carried_verbs=("plan", "apply"),
    )
