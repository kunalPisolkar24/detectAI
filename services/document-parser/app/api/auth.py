"""x-api-key guard for the extraction routes.

One accepted carrier, one comparison: the shared key travels as plaintext
and is verified with secrets.compare_digest; at-rest and in-transit
protection belong to Secrets Manager and TLS, not here. Every failure is
the same 401 so a missing header and a wrong key are indistinguishable to
the caller (requirements.md); rejections are logged for NFR-8 without
echoing the attempted value, and the rejected-request counter arrives with
the observability build.
"""

import logging
import secrets

from fastapi import HTTPException, Request, status

logger = logging.getLogger(__name__)

_REJECT_DETAIL = "invalid or missing API key"


def credential_matches(expected: str, candidate: str | None) -> bool:
    """Constant-time equivalence between the shared key and the presented one.

    Comparison runs on utf-8 bytes, so a non-ASCII candidate degrades to a
    plain mismatch instead of an encode error turning a 401 into a 500.
    """
    if candidate is None:
        return False
    try:
        candidate_bytes = candidate.encode("utf-8")
    except UnicodeEncodeError:
        return False
    return secrets.compare_digest(expected.encode("utf-8"), candidate_bytes)


async def api_key_auth(request: Request) -> None:
    """Guard dependency: the x-api-key header must equal the boot-resolved key.

    The expected key comes from the composition root (app.state.settings),
    so this dependency never touches the config planes itself.
    """
    candidate = request.headers.get("x-api-key")
    if credential_matches(request.app.state.settings.api_key, candidate):
        return
    logger.warning(
        "authentication rejected on %s: %s key", request.url.path, "missing" if candidate is None else "invalid"
    )
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=_REJECT_DETAIL)
