"""The authenticated extraction route.

The gate exists now; the multipart pipeline lands with the extract chunk
(http.md). Until then the route answers 501 after the guard, which is the
honest interim shape: the endpoint and its auth are reachable, extraction
is not.
"""

from fastapi import APIRouter, Depends, HTTPException, status

from .auth import api_key_auth

router = APIRouter()


@router.post("/api/v1/extract", dependencies=[Depends(api_key_auth)])
async def extract() -> dict[str, str]:
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="extraction pipeline not implemented yet",
    )
