import json
import os
from src.core.exceptions import SecretsWriteError
from src.domain.schemas import SecretPayload
from src.interfaces.secrets_store import ISecretsStore


def is_floci_endpoint(endpoint: str | None) -> bool:
    if not endpoint:
        return False
    return (
        "localhost:4566" in endpoint
        or "127.0.0.1:4566" in endpoint
        or "host.docker.internal:4566" in endpoint
    )


class Boto3SecretsManager(ISecretsStore):
    def __init__(self, region: str, endpoint_url: str | None):
        self.region = region
        self.endpoint_url = endpoint_url if endpoint_url else None

    def _client(self):  # type: ignore[no-untyped-def]
        try:
            import boto3  # type: ignore
            from botocore.exceptions import ClientError  # noqa: F401
        except ImportError as e:
            raise SecretsWriteError("boto3 is required (pip install boto3)") from e

        import boto3  # type: ignore

        kwargs: dict = {"region_name": self.region}
        if self.endpoint_url:
            kwargs["endpoint_url"] = self.endpoint_url
        # Floci needs test creds when host creds not set (mirrors apps/web/lib/config/aws.ts:21)
        if is_floci_endpoint(self.endpoint_url) and not os.getenv("AWS_ACCESS_KEY_ID"):
            kwargs["aws_access_key_id"] = "test"
            kwargs["aws_secret_access_key"] = "test"
        return boto3.client("secretsmanager", **kwargs)

    def upsert(self, payload: SecretPayload, dry_run: bool = False) -> str:
        if dry_run:
            return "dry-run"
        client = self._client()
        secret_string = json.dumps(payload.data, separators=(",", ":"))
        try:
            from botocore.exceptions import ClientError  # type: ignore

            try:
                client.describe_secret(SecretId=payload.name)
                client.put_secret_value(SecretId=payload.name, SecretString=secret_string)
                return "updated"
            except ClientError as e:
                code = e.response.get("Error", {}).get("Code", "")
                if code in ("ResourceNotFoundException", "InvalidRequestException"):
                    # InvalidRequestException can mean deleted secret pending recovery on Floci
                    try:
                        client.create_secret(Name=payload.name, SecretString=secret_string)
                        return "created"
                    except ClientError as ce2:
                        # if already exists race, fallback to put
                        if ce2.response.get("Error", {}).get("Code") == "ResourceExistsException":
                            client.put_secret_value(SecretId=payload.name, SecretString=secret_string)
                            return "updated"
                        raise
                # for other errors (access denied, etc.) bubble up
                if "not found" in str(e).lower():
                    client.create_secret(Name=payload.name, SecretString=secret_string)
                    return "created"
                raise
        except Exception as e:
            # wrap with context, but don't leak values
            raise SecretsWriteError(f"failed to upsert {payload.name}: {e}") from e

    def list_secrets(self) -> list[str]:
        client = self._client()
        out = client.list_secrets()
        return [s.get("Name", "") for s in out.get("SecretList", []) if s.get("Name")]
