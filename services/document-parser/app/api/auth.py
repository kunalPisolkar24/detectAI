"""x-api-key guard: constant-time compare, failures indistinguishable, no echo of the attempt."""

import logging
import secrets

from fastapi import HTTPException, Request, status

logger = logging.getLogger(__name__)

_REJECT_DETAIL = "invalid or missing API key"


def credential_matches(expected: str, candidate: str | None) -> bool:
    """Constant-time compare on utf-8 bytes — a non-ASCII candidate is a mismatch, not a 500."""
    if candidate is None:
        return False
    try:
        candidate_bytes = candidate.encode("utf-8")
    except UnicodeEncodeError:
        return False
    return secrets.compare_digest(expected.encode("utf-8"), candidate_bytes)


async def api_key_auth(request: Request) -> None:
    candidate = request.headers.get("x-api-key")
    if credential_matches(request.app.state.settings.api_key, candidate):
        return
    logger.warning(
        "authentication rejected on %s: %s key", request.url.path, "missing" if candidate is None else "invalid"
    )
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=_REJECT_DETAIL)
