import argparse
import base64
import hashlib
import hmac
import json
import time


def encode_segment(value):
    raw = json.dumps(value, separators=(",", ":"), sort_keys=True).encode("utf-8")
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def build_token(secret, subject, issued_at, ttl_seconds):
    header = {"alg": "HS256", "typ": "JWT"}
    payload = {"sub": subject, "iat": issued_at}

    if ttl_seconds > 0:
        payload["exp"] = issued_at + ttl_seconds

    header_segment = encode_segment(header)
    payload_segment = encode_segment(payload)
    signing_input = f"{header_segment}.{payload_segment}".encode("ascii")
    signature = hmac.new(secret.encode("utf-8"), signing_input, hashlib.sha256).digest()
    signature_segment = base64.urlsafe_b64encode(signature).rstrip(b"=").decode("ascii")

    return f"{header_segment}.{payload_segment}.{signature_segment}"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--secret", required=True)
    parser.add_argument("--subject", default="k6-load-tester")
    parser.add_argument("--ttl-seconds", type=int, default=3600)
    args = parser.parse_args()

    issued_at = int(time.time())
    print(build_token(args.secret, args.subject, issued_at, args.ttl_seconds))


if __name__ == "__main__":
    main()
