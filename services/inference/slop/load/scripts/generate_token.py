"""
Generate a HS256 JWT for inference load tests.

Used by `make load-test` to create `INFERENCE_LOAD_AUTH_TOKEN` from
`AI_SERVICE_API_KEY` when no token is supplied. No external dependencies —
only stdlib, matching the self-contained style of other load suites.
"""

import argparse
import base64
import hashlib
import hmac
import json
import time


def _b64url_encode(data: bytes) -> str:
    """Base64url encode without padding (RFC 7515)."""
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def encode_segment(value: dict) -> str:
    raw = json.dumps(value, separators=(",", ":"), sort_keys=True).encode("utf-8")
    return _b64url_encode(raw)


def build_token(secret: str, subject: str, issued_at: int, ttl_seconds: int) -> str:
    """Build HS256 JWT with `sub`, `iat`, and optional `exp`."""
    header = {"alg": "HS256", "typ": "JWT"}
    payload: dict = {"sub": subject, "iat": issued_at}
    if ttl_seconds > 0:
        payload["exp"] = issued_at + ttl_seconds

    header_b64 = encode_segment(header)
    payload_b64 = encode_segment(payload)
    signing_input = f"{header_b64}.{payload_b64}".encode("ascii")
    signature = hmac.new(secret.encode("utf-8"), signing_input, hashlib.sha256).digest()
    signature_b64 = _b64url_encode(signature)
    return f"{header_b64}.{payload_b64}.{signature_b64}"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate HS256 JWT for inference gRPC auth")
    parser.add_argument("--secret", required=True, help="HMAC secret (API_KEY)")
    parser.add_argument("--subject", default="k6-load-tester", help="JWT subject (sub)")
    parser.add_argument("--ttl-seconds", type=int, default=3600, help="Expiry TTL in seconds (0 = no exp)")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    issued_at = int(time.time())
    token = build_token(args.secret, args.subject, issued_at, args.ttl_seconds)
    print(token)


if __name__ == "__main__":
    main()
