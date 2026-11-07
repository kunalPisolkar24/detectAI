"""The verify verb: what the .env would seed, collected against the live plane."""

from __future__ import annotations

from app.engine.carrier.session import session_remaining_text
from app.kinds.secrets.declaration import SecretsDeclaration
from app.kinds.secrets.verify.audit import (
    compare_seeds,
    expected_blob,
    expected_ssm_seeds,
    fingerprint,
)
from app.kinds.secrets.verify.collect import (
    collect_secret,
    collect_ssm_parameters,
    secret_describe_command,
    secret_value_command,
    ssm_path_command,
)
from app.engine.values.plane import plane_display, resolve_region


def verify_flow(
    declaration: SecretsDeclaration,
    values: dict[str, str],
    is_emulator: bool,
    dry_run: bool,
    session: dict[str, str] | None = None,
) -> int:
    """Match the live plane against what the .env would seed. Values never
    surface: rows carry lengths and fingerprints; drift is exit code 1."""
    commands = [
        ssm_path_command(declaration, values, is_emulator),
        secret_describe_command(declaration, values, is_emulator),
        secret_value_command(declaration, values, is_emulator),
    ]
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
