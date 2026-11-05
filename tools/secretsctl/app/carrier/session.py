"""Carrier sessions: assume-role, MFA, and the locally cached 12-hour triplet."""

from __future__ import annotations

import getpass
import json
import os
import re
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from app.carrier.identity import (
    SESSION_DURATION_SECONDS,
    USER_ARN_RE,
    iam_account_id,
    seeder_role_arn,
    seeder_role_session_mark,
)
from app.carrier.policy import resolve_trust_principal
from app.carrier.role import _ensure_seeder_role
from app.declaration.model import Declaration
from app.shell import die, run_aws_captured
from app.values.plane import resolve_floci_url

MFA_CODE_RE = re.compile(r"^[0-9]{6}$")
SEEDER_MFA_SERIAL_KEY = "SEEDER_MFA_SERIAL"

SESSION_RENEWAL_MARGIN_SECONDS = 10 * 60


def role_session_name(declaration: Declaration) -> str:
    """A stable, sanitized name keeps each laptop's carrier session identifiable in CloudTrail."""
    raw = f"{declaration.slug}-{getpass.getuser()}"
    return re.sub(r"[^A-Za-z0-9=_,.@-]", ".", raw)


def mfa_serial_for(principal: str, override: str) -> str | None:
    """The caller's MFA device: the override, else derived from a plain user
    ARN. None when the principal is not an MFA-capable IAM user."""
    if override:
        return override
    if USER_ARN_RE.fullmatch(principal):
        account_id = principal.split(":")[4]
        return f"arn:aws:iam::{account_id}:mfa/{principal.split(':user/', 1)[1]}"
    return None


def _utcnow() -> datetime:
    return datetime.now(UTC)


def _expires_at_of(payload: dict[str, Any]) -> datetime:
    raw = str(payload.get("expires_at", ""))
    parsed = datetime.fromisoformat(raw)
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


def session_remaining_text(payload: dict[str, Any]) -> str:
    try:
        seconds = max(0, int((_expires_at_of(payload) - _utcnow()).total_seconds()))
    except (KeyError, ValueError):
        return "??:??"
    return f"{seconds // 60:02d}:{seconds % 60:02d}"


def cached_session(role_arn: str, session_cache: Path) -> dict[str, Any] | None:
    """The locally cached triplet for this role, only when it outlives the
    renewal margin; anything unusable reads as no cache."""
    try:
        payload = json.loads(session_cache.read_text())
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict) or payload.get("role_arn") != role_arn:
        return None
    if not all(payload.get(key) for key in ("access_key_id", "secret_access_key", "session_token")):
        return None
    try:
        remaining = (_expires_at_of(payload) - _utcnow()).total_seconds()
    except (KeyError, ValueError):
        return None
    return payload if remaining > SESSION_RENEWAL_MARGIN_SECONDS else None


def save_cached_session(session: dict[str, Any], session_cache: Path) -> None:
    """Atomically land the triplet with owner-only permissions; a write failure
    costs convenience, not the verb run."""
    try:
        session_cache.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(
            mode="w", dir=session_cache.parent, prefix=".aws-session-", suffix=".json", delete=False
        ) as handle:
            os.chmod(handle.name, 0o600)
            json.dump(session, handle, indent=2)
            handle.write("\n")
        os.replace(handle.name, session_cache)
    except OSError as exc:
        print(f"note: could not cache the seeder session locally ({exc}); the next verb re-prompts")


def clear_cached_session(session_cache: Path) -> bool:
    try:
        session_cache.unlink()
        return True
    except FileNotFoundError:
        return False


def assume_seeder_session(
    role_arn: str,
    serial: str | None,
    declaration: Declaration,
    is_emulator: bool = False,
) -> dict[str, Any]:
    """One assume-role exchange producing a 12-hour seeder session. The assume
    response itself proves the identity, so no follow-up caller check is needed.
    The real plane gates the call behind an MFA prompt; the emulator enforces no
    trust conditions, so it assumes without one."""
    command = ["aws"]
    if is_emulator:
        command += ["--endpoint-url", resolve_floci_url()]
    command += [
        "sts",
        "assume-role",
        "--role-arn",
        role_arn,
        "--role-session-name",
        role_session_name(declaration),
        "--duration-seconds",
        str(SESSION_DURATION_SECONDS),
        "--output",
        "json",
    ]
    if serial is None:
        print(f"carrier: assuming {declaration.seeder_role_name}")
    else:
        print(f"carrier: assuming {declaration.seeder_role_name} (MFA, valid for 12 hours)")
        code = input(f"MFA code for {serial}: ").strip()
        if not MFA_CODE_RE.fullmatch(code):
            die(
                f"{code!r} is not a 6-digit MFA code",
                "enter the six-digit code from your MFA device",
            )
        command += ["--serial-number", serial, "--token-code", code]
    exit_code, stdout, stderr = run_aws_captured(command, is_emulator)
    if exit_code != 0:
        stderr_text = (stderr or "").strip()
        detail = stderr_text.splitlines()[-1] if stderr_text else "unknown error"
        hint = f"check the MFA code and that the seeder role trusts your caller ({detail})"
        if "MaxSessionDuration" in stderr_text or "DurationSeconds" in stderr_text:
            hint = (
                f"the role's session cap is below {SESSION_DURATION_SECONDS}s, fix it with "
                f"aws iam update-role --role-name {declaration.seeder_role_name} "
                f"--max-session-duration {SESSION_DURATION_SECONDS} ({detail})"
            )
        die(f"could not assume {role_arn}", hint)
    try:
        payload = json.loads(stdout)
    except json.JSONDecodeError as exc:
        die(f"could not parse the assume-role output: {exc}", "rerun the verb")
    identity = (
        payload.get("AssumedRoleUser", {}).get("Arn", "") if isinstance(payload, dict) else ""
    )
    mark = seeder_role_session_mark(declaration)
    if mark not in identity:
        die(
            "the assumed identity is not the seeder role",
            f"expected an assumed-role/{declaration.seeder_role_name}/... session, got {identity or 'nothing'}",
        )
    credentials = payload.get("Credentials", {})
    triplet = {
        "access_key_id": credentials.get("AccessKeyId", ""),
        "secret_access_key": credentials.get("SecretAccessKey", ""),
        "session_token": credentials.get("SessionToken", ""),
        "expires_at": credentials.get("Expiration", ""),
    }
    if not all(triplet.values()):
        die("the assume-role response lacks usable credentials", "rerun the verb")
    return {"role_arn": role_arn, **triplet}


def resolve_carrier_session(
    declaration: Declaration,
    values: dict[str, str],
    is_emulator: bool,
    dry_run: bool,
    session_cache: Path,
) -> dict[str, Any] | None:
    """The carrier on both planes: cached triplet when valid, otherwise converge
    the service's out-of-stack seeder role (create or repair its trust, session
    cap, and policy) and take a fresh assume of it. Dry runs stay session-free."""
    if dry_run:
        return None
    principal = resolve_trust_principal(declaration, is_emulator)
    serial = None
    if not is_emulator:
        serial = mfa_serial_for(principal, values.get(SEEDER_MFA_SERIAL_KEY, ""))
        if serial is None:
            die(
                f"cannot derive the caller's MFA device (trust principal: {principal})",
                "run the verb under your IAM user credentials, or set "
                f"{SEEDER_MFA_SERIAL_KEY}=arn:aws:iam::<account-id>:mfa/<your-user> in .env",
            )
    role_arn = seeder_role_arn(declaration, iam_account_id(principal))
    session = cached_session(role_arn, session_cache)
    if session is None:
        _ensure_seeder_role(declaration, values, is_emulator)
        session = assume_seeder_session(role_arn, serial, declaration, is_emulator)
        save_cached_session(session, session_cache)
    return session
