"""The infra kind: the shared queue fabric, driven by tfctl."""

from __future__ import annotations

from app.kinds import Kind


# No check: this kind has nothing to validate off-plane (observability checks
# New Relic credentials; the queue fabric needs none at all).
VERBS = (
    "plan",
    "apply",
    "auto-apply",
    "destroy",
    "seeder-drop",
    "session-clear",
    "session-refresh",
)


def kind() -> Kind:
    """The infra Kind slot, built here so main.py composes it explicitly."""
    from app.kinds.infra.declaration import load
    from app.kinds.infra.flow import stack_verb_flow
    from app.kinds.infra.policy import seeder_policy_document
    from app.kinds.infra.tfvars import build_tf_vars
    from app.kinds.infra.values import resolve_plane, validate

    return Kind(
        name="infra",
        declaration_filename="infra.toml",
        values_relpath="envs/.env",
        # The terraform root is the declaration's own directory, not vendored.
        stack_root=None,
        values_hint="run `make env` in infra — no credentials; only the bucket and region shapes",
        load=load,
        build_tf_vars=build_tf_vars,
        seeder_policy=seeder_policy_document,
        validate=validate,
        resolve_plane=resolve_plane,
        my_verbs=VERBS,
        service_scoped=False,
        terraform_flow=stack_verb_flow,
        carried_verbs=("plan", "apply", "auto-apply", "destroy"),
    )
