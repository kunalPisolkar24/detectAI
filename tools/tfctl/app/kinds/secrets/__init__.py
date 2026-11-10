"""The secrets stack kind: one shared terraform template behind every service."""

from __future__ import annotations

from pathlib import Path

from app.kinds import Kind

STACK_ROOT = Path(__file__).resolve().parent / "stack"

VERBS = (
    "plan",
    "apply",
    "verify",
    "auto-apply",
    "destroy",
    "seeder-drop",
    "session-clear",
    "session-clear-all",
    "session-refresh-all",
)


def kind() -> Kind:
    """The one secrets Kind slot, built here so main.py composes it explicitly."""
    from app.kinds.secrets.declaration import load
    from app.kinds.secrets.flow import terraform_verb_flow
    from app.kinds.secrets.policy import seeder_policy_document
    from app.kinds.secrets.tfvars import build_tf_vars
    from app.kinds.secrets.values import resolve_plane, validate
    from app.kinds.secrets.verify.flow import verify_flow

    return Kind(
        name="secrets",
        declaration_filename="secrets.toml",
        values_relpath="infra/.env",
        stack_root=STACK_ROOT,
        values_hint="create the service's infra/.env first (copy its committed .env.example)",
        load=load,
        build_tf_vars=build_tf_vars,
        seeder_policy=seeder_policy_document,
        validate=validate,
        resolve_plane=resolve_plane,
        my_verbs=VERBS,
        service_scoped=True,
        terraform_flow=terraform_verb_flow,
        carried_verbs=("plan", "apply", "destroy", "auto-apply"),
        verify=verify_flow,
    )
