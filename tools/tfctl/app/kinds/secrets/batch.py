"""The session-refresh-all verb: every ready service's seeder session in one run."""

from __future__ import annotations

from typing import Any, NamedTuple

from app.engine.carrier.role import _ensure_seeder_role
from app.engine.carrier.session import (
    _carrier_target,
    assume_seeder_session,
    cached_session,
    prompt_mfa_code,
    save_cached_session,
    session_cache_for,
    session_remaining_text,
)
from app.engine.values.parse import parse_env_file
from app.engine.values.plane import emulator_endpoint_note, plane_display
from app.kinds.locate import Workspace
from app.kinds.secrets.declaration import Declaration, DeclarationError, load
from app.kinds.secrets.policy import seeder_policy_document
from app.kinds.secrets.values import validate


class Refreshable(NamedTuple):
    """A service cleared for a fresh seeder assume: the plan phase's output."""

    declaration: Declaration
    role_arn: str
    serial: str | None


def _assume_refreshable(
    refreshable: Refreshable, is_emulator: bool, codes: dict[str, str]
) -> dict[str, Any] | None:
    """One queued assume: the MFA code rides per device (entered lazily once,
    reused by every service gated on the same device), and a failed assume
    earns exactly one re-prompt — the batch read as window rollover, not a
    wrong-code loop — before the service is declared failed."""
    serial = refreshable.serial
    for attempt in (1, 2):
        code = None
        if serial is not None:
            code = codes.get(serial)
            if code is None:
                code = prompt_mfa_code(serial)
                codes[serial] = code
        try:
            return assume_seeder_session(
                refreshable.role_arn, serial, refreshable.declaration, is_emulator, token_code=code
            )
        except SystemExit:
            if attempt == 2:
                return None
            print(f"note: re-assuming {refreshable.declaration.slug} with a fresh MFA code")
            codes.pop(serial, None)
    return None


def refresh_all_flow(
    workspaces: list[Workspace], is_emulator: bool, force: bool, dry_run: bool
) -> int:
    """The session-refresh-all verb: every ready service's seeder session in
    one run. A still-valid cached triplet rides untouched unless --force; the
    plan phase converges each refreshable's role first, then one lazily
    prompted MFA code drives the assume batch — an assume-gated phase kept
    short enough to finish inside one token-code window. A failing service
    reports and the run continues; the exit code is 1 when any service ends
    neither refreshed nor riding a valid cache."""
    services_word = "service" if len(workspaces) == 1 else "services"
    print(f"refresh-all: {len(workspaces)} ready {services_word} on {plane_display(is_emulator)}")
    if not workspaces:
        print(
            "nothing to refresh: a service opts in with secrets.toml and infra/.env "
            "(see the tfctl README)"
        )
        return 0

    queued: list[Refreshable] = []
    failures, valid, skipped, refreshed = 0, 0, 0, 0

    for workspace in workspaces:
        service = workspace.stack_dir.name
        try:
            declaration = load(workspace.declaration_file)
            values = parse_env_file(workspace.values_file)
            if (note := emulator_endpoint_note(values, f"{service}'s values file")) is not None:
                print(note)
            errors = validate(declaration, values, is_emulator)
            if errors:
                for error in errors:
                    print(error)
                print(f"skipped: {declaration.slug} (fix the value errors above)")
                skipped += 1
                continue
            role_arn, serial = _carrier_target(declaration, values, is_emulator)
            cached = None if force else cached_session(role_arn, session_cache_for(declaration))
            if cached is not None:
                valid += 1
                remaining = session_remaining_text(cached)
                print(f"valid: {declaration.slug} (cached triplet rides, {remaining} left)")
                continue
            if dry_run:
                print(f"would refresh: {declaration.slug}")
                continue
            _ensure_seeder_role(declaration, values, is_emulator, seeder_policy_document)
            queued.append(Refreshable(declaration, role_arn, serial))
        except DeclarationError as exc:
            print(str(exc))
            print(f"failed: {service} (see its declaration error above)")
            failures += 1
        except SystemExit:
            print(f"failed: {service} (see the error above)")
            failures += 1

    if dry_run:
        print("(dry run: no assumes, no MFA)")
        return 1 if failures or skipped else 0

    codes: dict[str, str] = {}
    if queued and any(refreshable.serial for refreshable in queued):
        print("note: the assume batch enters each MFA device's code once, then reuses it")
    for refreshable in queued:
        triplet = _assume_refreshable(refreshable, is_emulator, codes)
        if triplet is None:
            print(f"failed: {refreshable.declaration.slug} (see its assume error above)")
            failures += 1
            continue
        save_cached_session(triplet, session_cache_for(refreshable.declaration))
        print(
            f"refreshed: {refreshable.declaration.slug} (valid {session_remaining_text(triplet)})"
        )
        refreshed += 1

    print(f"summary: {refreshed} refreshed, {valid} valid, {skipped} skipped, {failures} failed")
    return 1 if failures or skipped else 0
