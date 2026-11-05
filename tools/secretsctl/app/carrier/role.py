"""The seeder role itself: reading, converging, and dropping it."""

from __future__ import annotations

import json
from typing import Any
from urllib.parse import unquote

from app.carrier.identity import SESSION_DURATION_SECONDS
from app.carrier.policy import (
    resolve_trust_principal,
    seeder_policy_document,
    seeder_trust_document,
)
from app.declaration.model import Declaration
from app.shell import aws_base, die, run_aws, run_aws_captured
from app.values.rules import plane_errors

SEEDER_POLICY_NAME = "seeder-policy"


def validate_seeder_role(
    declaration: Declaration, values: dict[str, str], is_emulator: bool
) -> list[str]:
    """Only what role drop/delete consumes: region and endpoint."""
    return plane_errors(values)


def seeder_role_payload(
    declaration: Declaration, values: dict[str, str], is_emulator: bool
) -> dict[str, Any] | None:
    """The role's get-role payload, or None when the role is missing (or unreadable)."""
    code, stdout, _ = run_aws_captured(
        aws_base(declaration, values, is_emulator)
        + [
            "iam",
            "get-role",
            "--role-name",
            declaration.seeder_role_name,
            "--output",
            "json",
        ],
        is_emulator,
    )
    if code != 0:
        return None
    try:
        payload = json.loads(stdout)
    except json.JSONDecodeError:
        return None
    return payload if isinstance(payload, dict) and payload.get("Role") else None


def _document_of(raw: Any) -> dict[str, Any] | None:
    """An IAM payload's embedded policy document: already-JSON dict or URL-encoded string."""
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        try:
            parsed = json.loads(unquote(raw))
        except json.JSONDecodeError:
            return None
        return parsed if isinstance(parsed, dict) else None
    return None


def _ensure_seeder_role(
    declaration: Declaration, values: dict[str, str], is_emulator: bool
) -> None:
    """Create-on-demand with convergence, before every fresh assume: the
    emulator loses IAM on restart, a fresh real account starts empty, and an
    old role's trust, session cap, or policy may lag the code. A converged role
    passes silently; consistent output never blocks the verb."""
    base = aws_base(declaration, values, is_emulator)
    role_name = declaration.seeder_role_name
    principal = resolve_trust_principal(declaration, is_emulator)
    desired_trust = seeder_trust_document(principal)
    desired_policy = seeder_policy_document(declaration, values, is_emulator, principal)

    payload = seeder_role_payload(declaration, values, is_emulator)
    if payload is None:
        print(f"note: seeder role {role_name} is missing; creating it")
        code, _, stderr = run_aws_captured(
            base
            + [
                "iam",
                "create-role",
                "--role-name",
                role_name,
                "--assume-role-policy-document",
                json.dumps(desired_trust),
                "--max-session-duration",
                str(SESSION_DURATION_SECONDS),
            ],
            is_emulator,
        )
        if code != 0 and "EntityAlreadyExists" not in (stderr or ""):
            print("error: create-role failed")
            print((stderr or "").strip())
            die(
                "could not create the seeder role",
                "confirm your credentials may create IAM roles, then rerun the verb",
            )
        print(
            f"created: {role_name} (12h session cap)"
            if code == 0
            else f"ok: role {role_name} already exists"
        )
        if (
            run_aws(
                base
                + [
                    "iam",
                    "put-role-policy",
                    "--role-name",
                    role_name,
                    "--policy-name",
                    SEEDER_POLICY_NAME,
                    "--policy-document",
                    json.dumps(desired_policy),
                ],
                is_emulator,
            )
            != 0
        ):
            die(
                f"could not attach {SEEDER_POLICY_NAME}",
                f"attach {SEEDER_POLICY_NAME} manually, then rerun the verb",
            )
        scopes = ", ".join(statement["Sid"] for statement in desired_policy["Statement"])
        print(f"policy: {SEEDER_POLICY_NAME} attached ({scopes})")
        return

    role = payload["Role"]
    trust = _document_of(role.get("AssumeRolePolicyDocument"))
    if trust is None or trust != desired_trust:
        print(f"note: re-anchoring {role_name}'s trust to the caller ({principal})")
        if (
            run_aws(
                base
                + [
                    "iam",
                    "update-assume-role-policy",
                    "--role-name",
                    role_name,
                    "--policy-document",
                    json.dumps(desired_trust),
                ],
                is_emulator,
            )
            != 0
        ):
            die(
                f"could not re-anchor {role_name}'s trust",
                "confirm your credentials may update the role's trust policy",
            )
    cap = role.get("MaxSessionDuration")
    if not isinstance(cap, int) or cap < SESSION_DURATION_SECONDS:
        print(f"note: raising {role_name}'s session cap to 12h")
        if (
            run_aws(
                base
                + [
                    "iam",
                    "update-role",
                    "--role-name",
                    role_name,
                    "--max-session-duration",
                    str(SESSION_DURATION_SECONDS),
                ],
                is_emulator,
            )
            != 0
        ):
            # A stale cap is non-fatal: a 1h-capped role still assumes, and the
            # assume itself fails loudly with the manual fix when it matters.
            print(f"warning: could not raise {role_name}'s session cap")
    code, stdout, _ = run_aws_captured(
        base
        + [
            "iam",
            "get-role-policy",
            "--role-name",
            role_name,
            "--policy-name",
            SEEDER_POLICY_NAME,
            "--output",
            "json",
        ],
        is_emulator,
    )
    attached = None
    if code == 0:
        try:
            attached = _document_of(json.loads(stdout).get("PolicyDocument"))
        except (json.JSONDecodeError, AttributeError):
            attached = None
    if attached != desired_policy:
        print(f"note: re-attaching {SEEDER_POLICY_NAME} (drifted from the code's pin)")
        if (
            run_aws(
                base
                + [
                    "iam",
                    "put-role-policy",
                    "--role-name",
                    role_name,
                    "--policy-name",
                    SEEDER_POLICY_NAME,
                    "--policy-document",
                    json.dumps(desired_policy),
                ],
                is_emulator,
            )
            != 0
        ):
            die(
                f"could not re-attach {SEEDER_POLICY_NAME}",
                f"attach {SEEDER_POLICY_NAME} manually, then rerun the verb",
            )


def drop_seeder_commands(
    declaration: Declaration, values: dict[str, str], is_emulator: bool
) -> list[list[str]]:
    base = aws_base(declaration, values, is_emulator)
    return [
        base
        + [
            "iam",
            "delete-role-policy",
            "--role-name",
            declaration.seeder_role_name,
            "--policy-name",
            SEEDER_POLICY_NAME,
        ],
        base + ["iam", "delete-role", "--role-name", declaration.seeder_role_name],
    ]


def drop_seeder_flow(
    declaration: Declaration, values: dict[str, str], is_emulator: bool, dry_run: bool
) -> int:
    """Policy first, then role; a missing role is a no-op. Real AWS repeats the purge barrier."""
    commands = drop_seeder_commands(declaration, values, is_emulator)
    if dry_run:
        for command in commands:
            print(f"would run: {' '.join(command)}")
        print("(dry run: no AWS)")
        return 0
    if seeder_role_payload(declaration, values, is_emulator) is None:
        print(f"ok: role {declaration.seeder_role_name} does not exist; nothing to drop")
        return 0
    if not is_emulator:
        answer = input(
            f'type "{declaration.seeder_role_name}" to detach its policy and delete the role: '
        ).strip()
        if answer != declaration.seeder_role_name:
            print("cancelled: the seeder role is untouched")
            return 1
    if run_aws(commands[0], is_emulator) != 0:
        print(
            f"fix: detach {SEEDER_POLICY_NAME} manually, then rerun (an existing policy is overwritten by reruns)"
        )
        return 1
    print(f"detached: {SEEDER_POLICY_NAME}")
    if run_aws(commands[1], is_emulator) != 0:
        print("fix: delete the role manually once its inline policies are gone")
        return 1
    print(f"deleted: {declaration.seeder_role_name}")
    return 0
