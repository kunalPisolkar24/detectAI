"""Reading the live plane: paged SSM inventory and the stored secret blob."""

from __future__ import annotations

import json
from typing import Any

from app.kinds.secrets.declaration import SecretsDeclaration
from app.engine.shell import aws_base, run_aws_captured


def ssm_path_command(
    declaration: SecretsDeclaration, values: dict[str, str], is_emulator: bool
) -> list[str]:
    """The paged SSM inventory read (pagers add --next-token themselves)."""
    return aws_base(declaration, values, is_emulator) + [
        "ssm",
        "get-parameters-by-path",
        "--path",
        declaration.ssm_prefix,
        "--with-decryption",
        "--output",
        "json",
    ]


def secret_describe_command(
    declaration: SecretsDeclaration, values: dict[str, str], is_emulator: bool
) -> list[str]:
    return aws_base(declaration, values, is_emulator) + [
        "secretsmanager",
        "describe-secret",
        "--secret-id",
        declaration.secret_name,
        "--output",
        "json",
    ]


def secret_value_command(
    declaration: SecretsDeclaration, values: dict[str, str], is_emulator: bool
) -> list[str]:
    return aws_base(declaration, values, is_emulator) + [
        "secretsmanager",
        "get-secret-value",
        "--secret-id",
        declaration.secret_name,
        "--output",
        "json",
    ]


def collect_ssm_parameters(
    declaration: SecretsDeclaration,
    values: dict[str, str],
    is_emulator: bool,
    session: dict[str, str] | None = None,
) -> dict[str, dict[str, str]] | None:
    """Live parameter inventory keyed by full name: {name: {type, value}}; the
    CLI paginates, so the loop pulls page after page on NextToken."""
    prefix = declaration.ssm_prefix
    parameters: dict[str, dict[str, str]] = {}
    next_token: str | None = None
    for _ in range(100):  # seatbelt: the plane seeds at most a handful of pages
        command = ssm_path_command(declaration, values, is_emulator)
        if next_token:
            command += ["--next-token", next_token]
        code, stdout, stderr = run_aws_captured(command, is_emulator, session)
        if code != 0:
            if next_token:
                print(
                    f"error: could not page {prefix} parameters (first {len(parameters)} collected)"
                )
            else:
                print(f"error: could not list parameters under {prefix}")
            if stderr.strip():
                print(stderr.strip())
            return None
        try:
            payload = json.loads(stdout)
        except json.JSONDecodeError as exc:
            print(f"error: get-parameters-by-path returned unparseable output: {exc}")
            return None
        for entry in payload.get("Parameters") or []:
            parameters[entry["Name"]] = {
                "type": entry.get("Type", ""),
                "value": entry.get("Value", ""),
            }
        next_token = payload.get("NextToken")
        if not next_token:
            return parameters
    print("error: get-parameters-by-path pagination did not terminate after 100 pages")
    return None


def collect_secret(
    declaration: SecretsDeclaration,
    values: dict[str, str],
    is_emulator: bool,
    session: dict[str, str] | None = None,
) -> tuple[dict[str, Any] | None, dict[str, str] | None]:
    """(describe payload, stored blob keys). stored is None when the secret has
    no version yet or the value read failed; None describe means the secret is
    unreachable and the caller's checklist must abort."""
    code, stdout, stderr = run_aws_captured(
        secret_describe_command(declaration, values, is_emulator),
        is_emulator,
        session,
    )
    if code != 0:
        print(f"error: could not describe the secret {declaration.secret_name}")
        if "ResourceNotFound" in stderr:
            print("fix: the secret does not exist on this plane — run the apply verb")
        elif stderr.strip():
            print(stderr.strip())
        return None, None
    try:
        described = json.loads(stdout)
    except json.JSONDecodeError as exc:
        print(f"error: describe-secret returned unparseable output: {exc}")
        return None, None
    code, stdout, stderr = run_aws_captured(
        secret_value_command(declaration, values, is_emulator),
        is_emulator,
        session,
    )
    if code != 0:
        if "ResourceNotFound" in stderr:
            return described, None  # created empty, or its only version is pending deletion
        print(f"error: could not read the stored blob of {declaration.secret_name}")
        if stderr.strip():
            print(stderr.strip())
        return described, None
    try:
        payload = json.loads(stdout)
    except json.JSONDecodeError as exc:
        print(f"error: get-secret-value returned unparseable output: {exc}")
        return described, None
    blob: Any = payload.get("SecretString")
    try:
        return described, json.loads(blob) if blob is not None else None
    except (json.JSONDecodeError, TypeError):
        print("error: the stored blob is not JSON; the runtime pull contract expects {key: value}")
        return described, None
