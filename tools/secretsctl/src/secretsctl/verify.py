"""Fingerprint-only verification: the live plane matched against the .env values."""

from __future__ import annotations

import hashlib
import json
from typing import Any

from secretsctl.config import Declaration
from secretsctl.env import plane_display, resolve_region
from secretsctl.proc import aws_base, run_aws_captured
from secretsctl.seeder import session_remaining_text


def fingerprint(value: str) -> str:
    """Short reproducible checksum for locating drift; never renders the value."""
    return hashlib.sha256(value.encode()).hexdigest()[:12]


def expected_ssm_seeds(declaration: Declaration, values: dict[str, str]) -> dict[str, str]:
    """The SSM map the stack would seed: the .env-populated allowlist subset."""
    return {key: values[key] for key in declaration.ssm_keys if values.get(key, "") != ""}


def expected_blob(declaration: Declaration, values: dict[str, str]) -> dict[str, str]:
    """The blob contract rebuilt from .env: every declared key rides the blob when set."""
    return {key: values[key] for key in declaration.blob_keys if values.get(key, "") != ""}


def compare_seeds(
    expected: dict[str, str], live: dict[str, str]
) -> tuple[list[str], list[str], list[str]]:
    """Shared keys split by value fingerprint into (matched, mismatched); plus
    expected keys absent from the live plane."""
    matched, mismatched = [], []
    for key in sorted(set(expected) & set(live)):
        matched_or_mismatched = (
            matched if fingerprint(expected[key]) == fingerprint(live[key]) else mismatched
        )
        matched_or_mismatched.append(key)
    return matched, mismatched, sorted(set(expected) - set(live))


def verify_commands(
    declaration: Declaration, values: dict[str, str], is_emulator: bool
) -> list[list[str]]:
    """The three reads behind a verify run: parameter inventory, secret status, stored blob."""
    base = aws_base(declaration, values, is_emulator)
    return [
        base
        + [
            "ssm",
            "get-parameters-by-path",
            "--path",
            declaration.ssm_prefix,
            "--with-decryption",
            "--output",
            "json",
        ],
        base
        + [
            "secretsmanager",
            "describe-secret",
            "--secret-id",
            declaration.secret_name,
            "--output",
            "json",
        ],
        base
        + [
            "secretsmanager",
            "get-secret-value",
            "--secret-id",
            declaration.secret_name,
            "--output",
            "json",
        ],
    ]


def collect_ssm_parameters(
    declaration: Declaration,
    values: dict[str, str],
    is_emulator: bool,
    session: dict[str, str] | None = None,
) -> dict[str, dict[str, str]] | None:
    """Live parameter inventory keyed by full name: {name: {type, value}}; the
    CLI paginates, so the loop pulls page after page on NextToken."""
    prefix = declaration.ssm_prefix
    base = aws_base(declaration, values, is_emulator)
    parameters: dict[str, dict[str, str]] = {}
    next_token: str | None = None
    for _ in range(100):  # seatbelt: the plane seeds at most a handful of pages
        command = base + [
            "ssm",
            "get-parameters-by-path",
            "--path",
            prefix,
            "--with-decryption",
            "--output",
            "json",
        ]
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
    declaration: Declaration,
    values: dict[str, str],
    is_emulator: bool,
    session: dict[str, str] | None = None,
) -> tuple[dict[str, Any] | None, dict[str, str] | None]:
    """(describe payload, stored blob keys). stored is None when the secret has
    no version yet or the value read failed; None describe means the secret is
    unreachable and the caller's checklist must abort."""
    base = aws_base(declaration, values, is_emulator)
    code, stdout, stderr = run_aws_captured(
        base
        + [
            "secretsmanager",
            "describe-secret",
            "--secret-id",
            declaration.secret_name,
            "--output",
            "json",
        ],
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
        base
        + [
            "secretsmanager",
            "get-secret-value",
            "--secret-id",
            declaration.secret_name,
            "--output",
            "json",
        ],
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


def verify_flow(
    declaration: Declaration,
    values: dict[str, str],
    is_emulator: bool,
    dry_run: bool,
    session: dict[str, str] | None = None,
) -> int:
    """Match the live plane against what the .env would seed. Values never
    surface: rows carry lengths and fingerprints; drift is exit code 1."""
    commands = verify_commands(declaration, values, is_emulator)
    if dry_run:
        for command in commands:
            print(f"would run: {' '.join(command)}")
        print("(dry run: no AWS)")
        return 0
    plane = plane_display(is_emulator)
    print(f"plane:   {plane}")
    if session:
        print(
            f"carrier: role session ({declaration.seeder_role_name}, "
            f"valid {session_remaining_text(session)})"
        )
    print(f"region:  {resolve_region(declaration, values)}")

    findings: list[str] = []
    extras: list[str] = []

    expected_ssm = expected_ssm_seeds(declaration, values)
    print(f"ssm:     {declaration.ssm_prefix}")
    live = collect_ssm_parameters(declaration, values, is_emulator, session)
    if live is None:
        return 1
    full_names: dict[str, str] = {}
    live_values: dict[str, str] = {}
    for name, entry in live.items():
        leaf = name.removeprefix(declaration.ssm_prefix)
        full_names[leaf] = name
        live_values[leaf] = entry["value"]
    _, mismatched, missing = compare_seeds(expected_ssm, live_values)
    for leaf in sorted(live_values):
        if leaf not in expected_ssm:
            print(f"  extra: {full_names[leaf]}")
            extras.append(full_names[leaf])
            continue
        entry = live[full_names[leaf]]
        print(
            f"  {leaf:<32} {entry['type'] or '?':<12} "
            f"len {len(entry['value']):<6} fp {fingerprint(entry['value'])}"
        )
    for leaf in sorted(missing):
        print(f"  {leaf:<32} missing (expected from .env)")
        findings.append(f"{declaration.ssm_prefix}{leaf} is not seeded")
    for leaf in sorted(mismatched):
        print(f"  {leaf:<32} mismatch (expected fp {fingerprint(expected_ssm[leaf])})")
        findings.append(
            f"{declaration.ssm_prefix}{leaf} does not match .env (expected fp {fingerprint(expected_ssm[leaf])})"
        )

    blob_keys = expected_blob(declaration, values)
    print(f"secret:  {declaration.secret_name}")
    described, stored = collect_secret(declaration, values, is_emulator, session)
    if described is None:
        return 1
    if described.get("DeletedDate") or described.get("Status") == "PENDINGDELETION":
        findings.append(
            f"the secret is scheduled for deletion (window {described.get('RecoveryWindowInDays', '?')} days)"
        )
    if stored is None:
        print("  (no stored version)")
        if blob_keys:
            findings.append(
                f"the blob holds no version while .env expects {', '.join(sorted(blob_keys))}"
            )
    else:
        _, blob_mismatched, blob_missing = compare_seeds(blob_keys, stored)
        for key in sorted(stored):
            if key not in blob_keys:
                print(f"  extra: {key}")
                extras.append(key)
                continue
            print(f"  {key:<32} {'':12} len {len(stored[key]):<6} fp {fingerprint(stored[key])}")
        for key in sorted(blob_mismatched):
            print(f"  {key:<32} mismatch (expected fp {fingerprint(blob_keys[key])})")
            findings.append(
                f"{key} does not match .env (expected fp {fingerprint(blob_keys[key])})"
            )
        for key in sorted(blob_missing):
            print(f"  {key:<32} missing (expected from .env)")
            findings.append(f"{key} is missing from the stored blob")

    print()
    for note in extras:
        print(f"note:   {note} is on the plane outside the .env seed list")
    if findings:
        for finding in findings:
            print(f"problem: {finding}")
        print("fail:    the seeded plane does not match the .env values")
        return 1
    print("ok:      the seeded plane matches the .env values")
    return 0
