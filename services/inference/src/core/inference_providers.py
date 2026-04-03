import json
from typing import Any


def parse_inference_providers(value: Any) -> list[str]:
    if isinstance(value, str):
        normalized_value = value.strip()
        if not normalized_value:
            raise ValueError("INFERENCE_PROVIDERS must contain at least one provider")
        if normalized_value.startswith("["):
            try:
                value = json.loads(normalized_value)
            except json.JSONDecodeError as exc:
                raise ValueError(
                    "INFERENCE_PROVIDERS must be a valid JSON array or a comma-separated string"
                ) from exc
        else:
            value = normalized_value.split(",")

    if isinstance(value, tuple):
        value = list(value)

    if not isinstance(value, list):
        raise TypeError("INFERENCE_PROVIDERS must be a list of strings")

    providers: list[str] = []
    for provider in value:
        if not isinstance(provider, str):
            raise TypeError("INFERENCE_PROVIDERS must contain only strings")
        normalized_provider = provider.strip()
        if normalized_provider:
            providers.append(normalized_provider)

    if not providers:
        raise ValueError("INFERENCE_PROVIDERS must contain at least one provider")

    return providers
